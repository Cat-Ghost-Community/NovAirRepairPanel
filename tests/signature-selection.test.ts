import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import {signatureTransform,signaturePoint,signatureHasInk} from '../src/lib/signature-strokes';
import {signatureValidationError} from '../src/lib/signature-validation';
import {reconcileAssignmentSelection,selectAssignmentRange} from '../src/lib/assignment-selection';
import {boardHref} from '../src/lib/board-shared';
import type {AssignTicketCard} from '../src/lib/assign-shared';

const card=(id:number,branch=1):AssignTicketCard=>({id,branch_id:branch,number:`T-${id}`,customer_id:1,customer_name:'Fixture',customer_mobile:null,device_brand:null,device_model:null,device_type:null,created_at:'2026-01-01',status_name:'Received',status_color:null,status_category:'open',technician_id:null,technician_name:null,technician_color:null,assigned_at:null,estimated_completion:null,priority:'normal',phase:'awaiting',delayed:false,allowed_next:[],assignment_version:0,workflow_revision:1,technician2_id:null});

describe('signature drawing geometry and file integrity',()=>{
 it('maps a narrow high-DPI display back to exact drawing coordinates',()=>{
  const frame={width:600,height:200},view={width:300,height:200};
  assert.deepEqual(signatureTransform(frame,view),{scale:.5,x:0,y:50});
  assert.deepEqual(signaturePoint(150,100,frame,view),{x:300,y:100});
  assert.equal(signaturePoint(150,10,frame,view),null);
 });
 it('preserves proportions without accumulated rounding during repeated orientation changes',()=>{
  const frame={width:600,height:200};
  for(let i=0;i<100;i++){assert.deepEqual(signaturePoint(150,100,frame,{width:300,height:200}),{x:300,y:100});assert.deepEqual(signaturePoint(300,100,frame,frame),{x:300,y:100});}
 });
 it('does not publish a blank tap or accidental sub-three-pixel movement',()=>{
  assert.equal(signatureHasInk([]),false);assert.equal(signatureHasInk([[{x:20,y:20}]]),false);
  assert.equal(signatureHasInk([[{x:0,y:0},{x:1,y:1}]]),false);
  assert.equal(signatureHasInk([[{x:0,y:0},{x:4,y:0}]]),true);
 });
 it('accepts a real encoded PNG and preserves its original bytes',async()=>{
  const bytes=await QRCode.toBuffer('Signature integrity',{width:120});const data='data:image/png;base64,'+bytes.toString('base64');
  assert.equal(signatureValidationError(data,true),null);assert.equal(Buffer.from(data.slice(22),'base64').equals(bytes),true);
 });
 it('rejects corrupt, truncated, oversize and non-PNG evidence',async()=>{
  const bytes=await QRCode.toBuffer('Signature integrity',{width:120});
  const damaged=Buffer.from(bytes);damaged[45]^=1;
  const oversized=Buffer.from(bytes);oversized.writeUInt32BE(5000,16);
  for(const data of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AAAA', 'data:image/png;base64,'+damaged.toString('base64'),'data:image/png;base64,'+bytes.subarray(0,-10).toString('base64'),'data:image/png;base64,'+oversized.toString('base64'),'data:image/png;base64,'+'A'.repeat(500001)])assert.ok(signatureValidationError(data,true));
  assert.equal(signatureValidationError(null),null);assert.ok(signatureValidationError(null,true));
 });
 it('rejects damaged compressed pixels even when every chunk CRC was forged correctly',async()=>{
  const bytes=await QRCode.toBuffer('Compressed evidence',{width:120});
  let offset=8;
  while(bytes.toString('ascii',offset+4,offset+8)!=='IDAT')offset+=bytes.readUInt32BE(offset)+12;
  const length=bytes.readUInt32BE(offset);bytes.fill(0,offset+8,offset+8+length);
  // Independent bit-at-a-time checksum, not the production lookup implementation.
  let crc=0xffffffff;for(const byte of bytes.subarray(offset+4,offset+8+length)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;}
  bytes.writeUInt32BE((crc^0xffffffff)>>>0,offset+8+length);
  assert.match(signatureValidationError('data:image/png;base64,'+bytes.toString('base64'),true)!,/داده‌های تصویر/);
 });
});

describe('inbox selection and board navigation',()=>{
 it('selects and clears a Shift range without selecting hidden or foreign-page records',()=>{
  const cards=[card(1),card(2),card(3),card(4)];
  let selected=selectAssignmentRange(new Map(),cards,1,null,false);
  selected=selectAssignmentRange(selected,cards,3,1,true);assert.deepEqual([...selected.keys()],[1,2,3]);
  selected=selectAssignmentRange(selected,cards,2,3,true);assert.deepEqual([...selected.keys()],[1]);
  assert.deepEqual([...selectAssignmentRange(selected,cards,100,1,true).keys()],[1]);
 });
 it('drops disappeared, reassigned, ABA-versioned, policy-changed and cross-branch selections',()=>{
  const original=[card(1),card(2),card(3),card(4),card(5),card(6),card(7)];
  const selection=new Map(original.map(c=>[c.id,c]));
  const current=[original[0],{...original[1],assignment_version:2},{...original[2],technician_id:9},{...original[3],branch_id:2},{...original[4],workflow_revision:2},{...original[5],technician2_id:10}];
  assert.deepEqual([...reconcileAssignmentSelection(selection,current).keys()],[1]);
 });
 it('keeps user search and technician filters when navigating layouts or stages',()=>{
  const query={q:'A & B',tech:'7',page:'4',view:'board'};
  const stage=new URL(boardHref(query,{status:'12'}),'http://test');assert.equal(stage.searchParams.get('q'),'A & B');assert.equal(stage.searchParams.get('tech'),'7');assert.equal(stage.searchParams.get('status'),'12');assert.equal(stage.searchParams.has('page'),false);
  const layout=new URL(boardHref(query,{view:'list'},false),'http://test');assert.equal(layout.searchParams.get('page'),'4');assert.equal(layout.searchParams.get('view'),'list');
 });
});
