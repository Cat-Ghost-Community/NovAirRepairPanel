import {it} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{auditSource,inventory}=require('../scripts/audit-network-dependencies.cjs') as {auditSource:(file:string,source:string)=>{violations:unknown[]};inventory:()=>{violations:unknown[]}};
it('rejects new remote scripts, fonts, embedded print resources, imports and unguarded server transports',()=>{
 for(const [file,source]of [['client.tsx','"use client";const x=<script src="https://cdn.example.invalid/a.js"/>'],['print.ts','const html=`<img src="//remote.invalid/image.png">`'],['font.css','@font-face{src:url(https://remote.invalid/font.woff2)}'],['server.ts','fetch("https://api.kavenegar.com/path")'],['module.ts','import("https://remote.invalid/m.js")']])assert.ok(auditSource(file,source).violations.length>0,file);
 assert.ok(auditSource('print.ts','const html=`<style>@font-face{src:url("https://remote.invalid/font.woff2")}</style>`').violations.length>0);
 assert.ok(auditSource('client.tsx','const x=<img srcSet="/local.png 1x, https://remote.invalid/image.png 2x"/>').violations.length>0);
 assert.ok(auditSource('sprite.svg','<svg><use href="https://remote.invalid/sprite.svg#icon"/></svg>').violations.length>0);
});
it('does not confuse documentation links, namespace identifiers, relative resources and guarded domestic calls with runtime violations',()=>{
 for(const [file,source]of [['link.tsx','const x=<a href="https://example.com">Help</a>'],['namespace.svg','<svg xmlns="http://www.w3.org/2000/svg"/>'],['client.tsx','"use client";fetch("/api/customers");const x=<img src="/api/files/1"/>'],['server.ts','fetch(assertOutboundUrl(url),{redirect:"error"})']])assert.deepEqual(auditSource(file,source).violations,[],file);
});
it('current application sources and exact localized font bytes satisfy runtime policy',()=>{assert.deepEqual(inventory().violations,[]);});
