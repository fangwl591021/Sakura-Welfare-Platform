import {deflateSync} from 'node:zlib';

// Code-generated, non-photographic fixture; no user media or external assets.
function crc32(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0)}return(value^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,checksum])}
export function syntheticArticlePng(width=640,height=320){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const pixels=Buffer.alloc((width*3+1)*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const at=y*(width*3+1)+1+x*3;
  const edge=x<12||y<12||x>=width-12||y>=height-12;
  const center=x>width*.28&&x<width*.72&&y>height*.22&&y<height*.78;
  const color=edge?[31,75,96]:center?[242,153,74]:[220,238,245];
  pixels[at]=color[0];pixels[at+1]=color[1];pixels[at+2]=color[2];
 }
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
