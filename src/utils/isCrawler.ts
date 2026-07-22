const CRAWLER_PATTERNS: RegExp[] = [
  /googlebot/i,
  /bingbot/i,
  /slurp/i,
  /duckduckbot/i,
  /baiduspider/i,
  /yandexbot/i,
  /sogou/i,
  /exabot/i,
  /facebot/i,
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  /applebot/i,
  /whatsapp/i,
  /telegrambot/i,
  /discordbot/i,
  /skypeuripreview/i,
  /pinterest/i,
  /slackbot/i,
  /gptbot/i,
  /chatgpt-user/i,
  /perplexitybot/i,
  /claudebot/i,
  /anthropic-ai/i,
  /amazonbot/i,
  /bytespider/i,
  /prerender/i,
  /netlify prerender/i,
  /headlesschrome/i,
  /phantomjs/i,
  /puppeteer/i,
];

export function isCrawler(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (!ua) return false;
  return CRAWLER_PATTERNS.some((re) => re.test(ua));
}
