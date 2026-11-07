import { inflateSync } from 'node:zlib';

/** Validate new PNG evidence with bounded decompression; never rewrite stored images. */
const crcTable = Array.from({length:256},(_,index)=>{let value=index;for(let bit=0;bit<8;bit++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc32(bytes:Buffer){let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}

function validScanlines(chunks:Buffer[],width:number,height:number,depth:number,color:number,interlaced:boolean){
  const channels=({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[color];
  const passes=interlaced?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
  const rows=passes.map(([x,y,dx,dy])=>{const w=Math.max(0,Math.ceil((width-x)/dx)),h=Math.max(0,Math.ceil((height-y)/dy));return {bytes:Math.ceil(w*channels*depth/8)+1,count:w?h:0};});
  const length=rows.reduce((sum,row)=>sum+row.bytes*row.count,0);
  try{
    const decoded=inflateSync(Buffer.concat(chunks),{maxOutputLength:length+1});
    if(decoded.length!==length)return false;
    let offset=0;
    for(const row of rows)for(let i=0;i<row.count;i++){if(decoded[offset]>4)return false;offset+=row.bytes;}
    return true;
  }catch{return false;}
}

export function signatureValidationError(value:unknown,required=false):string|null {
  if(value===null||value===undefined||value==='')return required?'امضای دست‌نویس الزامی است.':null;
  if(typeof value!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return 'تصویر امضا نامعتبر است؛ امضا را دوباره رسم کنید.';
  if(value.length>500_000)return 'حجم امضا بیش از حد مجاز است.';
  const encoded=value.slice(22),bytes=Buffer.from(encoded,'base64');
  if(bytes.toString('base64')!==encoded||bytes.length<57||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'ساختار تصویر امضا معتبر نیست.';
  if(bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')return 'ساختار تصویر امضا معتبر نیست.';
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width||!height||width>4096||height>2048||width*height>4_194_304)return 'ابعاد تصویر امضا بیش از حد مجاز است.';
  const color=bytes[25],depth=bytes[24];
  if(![0,2,3,4,6].includes(color)||!(color===0?[1,2,4,8,16]:color===3?[1,2,4,8]:[8,16]).includes(depth)||bytes[26]!==0||bytes[27]!==0||bytes[28]>1)return 'قالب تصویر امضا پشتیبانی نمی‌شود.';
  let offset=8,sawData=false,sawPalette=false;
  const imageChunks:Buffer[]=[];
  for(let chunk=0;chunk<1024&&offset+12<=bytes.length;chunk++){
    const length=bytes.readUInt32BE(offset),end=offset+length+12;
    if(end>bytes.length)return 'تصویر امضا ناقص است؛ دوباره تلاش کنید.';
    const type=bytes.toString('ascii',offset+4,offset+8);
    if(!/^[A-Za-z]{4}$/.test(type)||crc32(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))return 'تصویر امضا آسیب دیده است؛ دوباره رسم کنید.';
    if(type==='IHDR'&&offset!==8)return 'ساختار تصویر امضا معتبر نیست.';
    if(type==='PLTE'){if(sawData||length===0||length%3!==0||length>768)return 'ساختار رنگ تصویر امضا معتبر نیست.';sawPalette=true;}
    if(type==='IDAT'&&length>0){sawData=true;imageChunks.push(bytes.subarray(offset+8,end-4));}
    if(type==='IEND'){
      if(!sawData||length!==0||end!==bytes.length||(color===3&&!sawPalette))return 'تصویر امضا ناقص است؛ دوباره تلاش کنید.';
      return validScanlines(imageChunks,width,height,depth,color,bytes[28]===1)?null:'داده‌های تصویر امضا آسیب دیده است؛ دوباره رسم کنید.';
    }
    if(type[0]===type[0].toUpperCase()&&!['IHDR','PLTE','IDAT'].includes(type))return 'قالب تصویر امضا پشتیبانی نمی‌شود.';
    offset=end;
  }
  return 'تصویر امضا ناقص است؛ دوباره تلاش کنید.';
}
