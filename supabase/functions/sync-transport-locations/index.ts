import { createClient } from 'npm:@supabase/supabase-js@2.39.6';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    // Verify admin access
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: 'Missing authorization header'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({
        error: 'Unauthorized'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Check if user is admin
    const { data: userData, error: userError } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle();
    if (userError || !userData || userData.role !== 'admin') {
      return new Response(JSON.stringify({
        error: 'Admin access required'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const { cityIds, systemTypes, forceRefresh = false } = await req.json();
    // Get cities to process
    let citiesQuery = supabase.from('cities').select('*').eq('is_active', true).order('priority');
    if (cityIds && cityIds.length > 0) {
      citiesQuery = citiesQuery.in('id', cityIds);
    }
    const { data: cities, error: citiesError } = await citiesQuery;
    if (citiesError || !cities || cities.length === 0) {
      return new Response(JSON.stringify({
        error: 'No cities found to process'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Create sync log
    const { data: syncLog, error: syncLogError } = await supabase.from('osm_sync_logs').insert({
      status: 'running',
      executed_by: user.id,
      execution_mode: 'manual'
    }).select().single();
    if (syncLogError || !syncLog) {
      throw new Error('Failed to create sync log');
    }
    let totalProcessed = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalErrors = 0;
    const errors = [];
    // Process each city
    for (const city of cities){
      try {
        console.log(`Processing city: ${city.name}`);
        // Get transport systems for this city
        let systemsQuery = supabase.from('transport_systems').select('*').eq('city_id', city.id).eq('is_active', true);
        if (systemTypes && systemTypes.length > 0) {
          systemsQuery = systemsQuery.in('system_type', systemTypes);
        }
        const { data: systems, error: systemsError } = await systemsQuery;
        if (systemsError || !systems) {
          console.error(`Failed to get systems for ${city.name}:`, systemsError);
          totalErrors++;
          errors.push({
            city: city.name,
            error: 'Failed to get transport systems'
          });
          continue;
        }
        // Process each transport system
        for (const system of systems){
          try {
            console.log(`Processing system: ${system.name}`);
            // Build Overpass query
            const query = buildOverpassQuery(city, system);
            const overpassUrl = 'https://overpass-api.de/api/interpreter';
            // Query Overpass API with timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(()=>controller.abort(), 30000); // 30s timeout
            const overpassResponse = await fetch(overpassUrl, {
              method: 'POST',
              body: query,
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!overpassResponse.ok) {
              throw new Error(`Overpass API error: ${overpassResponse.status}`);
            }
            const osmData = await overpassResponse.json();
            console.log(`Found ${osmData.elements?.length || 0} elements for ${system.name}`);
            if (!osmData.elements || osmData.elements.length === 0) {
              continue;
            }
            // Process each OSM element
            for (const element of osmData.elements){
              if (!element.tags || !element.tags.name) {
                continue;
              }
              totalProcessed++;
              try {
                // Check if location exists
                const osmId = `osm-${element.type}-${element.id}`;
                const { data: existingLocation } = await supabase.from('departure_locations').select('id').eq('mapbox_id', osmId).maybeSingle();
                const locationData = {
                  name: element.tags.name,
                  location: `POINT(${element.lon} ${element.lat})`,
                  address: buildAddress(element.tags, city),
                  city: city.name,
                  state: city.state,
                  aliases: buildAliases(element.tags),
                  mapbox_id: osmId,
                  place_type: system.system_type,
                  is_active: true
                };
                if (existingLocation) {
                  // Update existing location
                  await supabase.from('departure_locations').update({
                    ...locationData,
                    updated_at: new Date().toISOString()
                  }).eq('id', existingLocation.id);
                  totalUpdated++;
                } else {
                  // Insert new location
                  await supabase.from('departure_locations').insert(locationData);
                  totalInserted++;
                }
                // Also insert into featured_pois for quick search
                const { data: existingPOI } = await supabase.from('featured_pois').select('id').eq('name', element.tags.name).eq('city', city.name).maybeSingle();
                const poiData = {
                  name: element.tags.name,
                  latitude: element.lat,
                  longitude: element.lon,
                  city: city.name,
                  poi_type: system.system_type,
                  description: buildDescription(element.tags, system)
                };
                if (!existingPOI) {
                  await supabase.from('featured_pois').insert(poiData);
                }
                // Small delay to avoid rate limiting
                if (totalProcessed % 10 === 0) {
                  await new Promise((resolve)=>setTimeout(resolve, 100));
                }
              } catch (elementError) {
                console.error(`Error processing element ${element.id}:`, elementError);
                totalErrors++;
              }
            }
            // Delay between systems to respect Overpass API rate limits
            await new Promise((resolve)=>setTimeout(resolve, 1000));
          } catch (systemError) {
            console.error(`Error processing system ${system.name}:`, systemError);
            totalErrors++;
            errors.push({
              city: city.name,
              system: system.name,
              error: systemError instanceof Error ? systemError.message : 'Unknown error'
            });
          }
        }
      } catch (cityError) {
        console.error(`Error processing city ${city.name}:`, cityError);
        totalErrors++;
        errors.push({
          city: city.name,
          error: cityError instanceof Error ? cityError.message : 'Unknown error'
        });
      }
    }
    // Update sync log
    await supabase.from('osm_sync_logs').update({
      status: totalErrors > 0 ? 'completed_with_errors' : 'completed',
      completed_at: new Date().toISOString(),
      total_processed: totalProcessed,
      total_inserted: totalInserted,
      total_updated: totalUpdated,
      total_errors: totalErrors,
      error_details: errors.length > 0 ? errors : null
    }).eq('id', syncLog.id);
    return new Response(JSON.stringify({
      success: true,
      syncLogId: syncLog.id,
      stats: {
        citiesProcessed: cities.length,
        totalProcessed,
        totalInserted,
        totalUpdated,
        totalErrors
      },
      errors: errors.length > 0 ? errors : undefined
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Sync error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
function buildOverpassQuery(city, system) {
  const bbox = `${city.bbox_south},${city.bbox_west},${city.bbox_north},${city.bbox_east}`;
  const osmQuery = system.osm_query;
  const queries = [];
  // Build node queries based on osm_query
  for (const [key, values] of Object.entries(osmQuery)){
    const valueArray = Array.isArray(values) ? values : [
      values
    ];
    for (const value of valueArray){
      queries.push(`node["${key}"="${value}"](${bbox});`);
    }
  }
  return `[out:json][timeout:25];(${queries.join('')});out body;>;out skel qt;`;
}
function buildAddress(tags, city) {
  const parts = [];
  if (tags['addr:street']) {
    parts.push(tags['addr:street']);
  }
  if (tags['addr:housenumber']) {
    parts.push(tags['addr:housenumber']);
  }
  if (parts.length === 0 && tags.name) {
    parts.push(tags.name);
  }
  parts.push(city.name);
  parts.push(city.state);
  return parts.join(', ');
}
function buildAliases(tags) {
  const aliases = [];
  if (tags['alt_name']) {
    aliases.push(tags['alt_name']);
  }
  if (tags['official_name']) {
    aliases.push(tags['official_name']);
  }
  if (tags['short_name']) {
    aliases.push(tags['short_name']);
  }
  if (tags['ref']) {
    aliases.push(tags['ref']);
  }
  if (tags['line']) {
    aliases.push(`Línea ${tags['line']}`);
  }
  return aliases;
}
function buildDescription(tags, system) {
  const parts = [
    system.name
  ];
  if (tags.line) {
    parts.push(`Línea ${tags.line}`);
  }
  if (tags.network) {
    parts.push(tags.network);
  }
  return parts.join(' - ');
}
