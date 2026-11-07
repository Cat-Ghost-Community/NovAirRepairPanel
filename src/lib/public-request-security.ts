import {isIP} from 'node:net';
import type {NextRequest} from 'next/server';
import {trackingRateLimit} from '@/lib/tracking';

/** Enable only behind a private listener and a proxy that overwrites X-Real-IP.
 * Forwarded chains are never used as signature evidence or throttle identity. */
export function trustedClientIp(req:NextRequest):string|null{
 if(process.env.REPAID_TRUST_PROXY!=='1')return null;
 const value=req.headers.get('x-real-ip')?.trim();
 return value&&value.length<=45&&isIP(value)?value:null;
}
export function limitPublicEstimate(req:NextRequest,token:string){
 // Global fallback also bounds traffic when no trusted client identity exists.
 trackingRateLimit('estimate:global',300);
 const ip=trustedClientIp(req);if(ip)trackingRateLimit(`estimate:client:${ip}`,30);
 trackingRateLimit(`estimate:document:${token.slice(0,128)}`,10);
}
