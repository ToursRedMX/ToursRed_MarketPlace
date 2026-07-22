import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Leer variables del .env
const envContent = fs.readFileSync('.env', 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, value] = line.split('=');
  if (key && value) {
    envVars[key.trim()] = value.trim();
  }
});

const supabaseUrl = envVars.VITE_SUPABASE_URL;
const supabaseAnonKey = envVars.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function uploadLogo() {
  try {
    const filePath = 'public/logo copy copy copy.png';
    const fileBuffer = fs.readFileSync(filePath);

    console.log('📤 Subiendo logo...');

    const { data, error } = await supabase.storage
      .from('images')
      .upload('email-logo.png', fileBuffer, {
        contentType: 'image/png',
        upsert: true
      });

    if (error) {
      console.error('❌ Error:', error);
      return;
    }

    const { data: publicUrl } = supabase.storage
      .from('images')
      .getPublicUrl('email-logo.png');

    console.log('✅ Logo subido correctamente');
    console.log('🔗 URL pública:', publicUrl.publicUrl);

    // Guardar URL en archivo temporal
    fs.writeFileSync('/tmp/logo_url.txt', publicUrl.publicUrl);
  } catch (err) {
    console.error('❌ Error general:', err);
  }
}

uploadLogo();
