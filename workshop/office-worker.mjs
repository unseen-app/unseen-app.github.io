import { inflateSync } from './vendor/fflate/esm/browser.js';
import { zipDirectory, MAX_FILE } from './file-guard.mjs';

const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let value=0xffffffff;for(const byte of bytes)value=table[(value^byte)&255]^(value>>>8);return(value^0xffffffff)>>>0;}
self.onmessage=event=>{
  try{
    const buffer=event.data?.buffer;
    if(!(buffer instanceof ArrayBuffer)||buffer.byteLength>MAX_FILE)throw new Error('Некорректный файл.');
    const bytes=new Uint8Array(buffer),entries=zipDirectory(bytes),texts=[];
    let total=0;
    for(const [name,entry]of entries){
      if(!(name==='mimetype'||name.endsWith('.xml')||name.endsWith('.rels')))continue;
      total+=entry.original;
      if(entry.original>2*1024*1024||total>12*1024*1024)throw new Error('XML документа превышает безопасный размер.');
      const packed=bytes.subarray(entry.data,entry.data+entry.compressed);
      const data=entry.method===0?packed:inflateSync(packed,{out:new Uint8Array(entry.original)});
      if(data.length!==entry.original||crc32(data)!==entry.crc)throw new Error('Нарушена целостность офисного документа.');
      let text;
      try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{throw new Error('Некорректная кодировка документа.');}
      if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('Документы с DTD и XML-сущностями не принимаются.');
      texts.push([name,text]);
    }
    self.postMessage({ok:true,texts,names:[...entries.keys()]});
  }catch(error){self.postMessage({ok:false,error:error.message||'Повреждён офисный документ.'});}
};
