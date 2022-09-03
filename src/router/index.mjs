import stream from './stream.mjs';
import r2 from './r2.mjs';

export default async (req, env) => {

  const url = new URL(req.url);
  const path = url.pathname.slice(1).split('/');

  // Make sure we have an api key in the url
  if (!url.searchParams.has('apiKey')) return new Response('Unauthorized', {status: 401});

  // Make sure the api key is valid
  if (url.searchParams.get('apiKey') !== env.API_KEY) return new Response('Unauthorized', {status: 401});

  if (!path[0]) return new Response('Error', {status: 500});

  // Handle requests to `stream` endpoint
  if (path[0] === 'stream') return await stream(req, env);

  // Handle requests to `r2` endpoint
  if (path[0] === 'r2') return await r2(req, env);

  // Handle any other requests
  return new Response('Not Found', {status: 404});
}