export const MAX_FILE = 35 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
export const MAX_PAGES = 50;
export const ACCEPT = '.jpg,.jpeg,.jpe,.jfif,.png,.webp,.gif,.bmp,.avif,.heic,.heif,.tif,.tiff,.pdf,.docx,.xlsx,.pptx,.odt,.ods,.odp,.txt,.csv';
const extensions = new Map([
  ['jpg','jpeg'],['jpeg','jpeg'],['jpe','jpeg'],['jfif','jpeg'],['png','png'],['webp','webp'],['gif','gif'],['bmp','bmp'],['avif','avif'],['heic','heif'],['heif','heif'],['tif','tiff'],['tiff','tiff'],
  ['pdf','pdf'],['docx','docx'],['xlsx','xlsx'],['pptx','pptx'],['odt','odt'],['ods','ods'],['odp','odp'],['txt','txt'],['csv','txt'],
]);
const executable = /^(exe|dll|com|scr|msi|msix|appx|bat|cmd|ps1|vbs|vbe|js|jse|mjs|cjs|hta|html?|xhtml|svgz?|php|py|sh|jar|wasm|lnk|url|reg)$/i;
const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));
const fail = text => { throw new Error(text); };
export function dimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 20000 || height > 20000 || width * height > MAX_PIXELS) fail('Изображение слишком большое: максимум 40 Мп и 20 000 px по стороне.');
  return { width, height };
}

export function checkName(name, size) {
  if (typeof name !== 'string' || name.length > 240 || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069<>:"|?*\\/]/.test(name)) fail('Недопустимое имя файла. Переименуй файл без специальных символов.');
  if (!size || size > MAX_FILE) fail('Выбери непустой файл размером до 35 МБ.');
  const parts = name.toLowerCase().split('.');
  const kind = extensions.get(parts.pop());
  if (!kind) fail('Этот формат не поддерживается. Открой список разрешённых форматов под кнопкой загрузки.');
  if (parts.some(part => executable.test(part))) fail('Файл с двойным исполняемым расширением не принимается.');
  return kind;
}

export function sniff(bytes) {
  if (bytes.length < 4) return 'unknown';
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes.subarray(0,8).every((value,index) => value === [137,80,78,71,13,10,26,10][index])) return 'png';
  if (ascii(bytes,0,4) === 'RIFF' && ascii(bytes,8,12) === 'WEBP') return 'webp';
  if (['GIF87a','GIF89a'].includes(ascii(bytes,0,6))) return 'gif';
  if (ascii(bytes,0,2) === 'BM') return 'bmp';
  if ((ascii(bytes,0,2) === 'II' && v.getUint16(2,true) === 42) || (ascii(bytes,0,2) === 'MM' && v.getUint16(2,false) === 42)) return 'tiff';
  if (ascii(bytes,0,5) === '%PDF-') return 'pdf';
  if (v.getUint32(0,true) === 0x04034b50) return 'zip';
  if (ascii(bytes,0,2) === 'MZ' || ascii(bytes,0,4) === '\x7fELF' || ascii(bytes,0,4) === '\0asm' || [0xd0,0xcf,0x11,0xe0].every((b,i)=>bytes[i]===b)) return 'executable';
  if (bytes.length >= 16 && ascii(bytes,4,8) === 'ftyp') {
    const size = v.getUint32(0);
    if (size < 16 || size > Math.min(bytes.length,4096) || size % 4) return 'unknown';
    const brands = [ascii(bytes,8,12)];
    for (let i=16;i<size;i+=4) brands.push(ascii(bytes,i,i+4));
    if (brands.some(b=>['avif','avis'].includes(b))) return 'avif';
    if (brands.some(b=>['heic','heix','hevc','hevx','mif1','msf1'].includes(b))) return 'heif';
  }
  return 'unknown';
}

export function checkImage(bytes, kind) {
  const v = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if (kind === 'png') {
    if (bytes.length < 45 || ascii(bytes,12,16) !== 'IHDR' || v.getUint32(8) !== 13) fail('Повреждена структура PNG.');
    const size = dimensions(v.getUint32(16),v.getUint32(20));
    let offset=8, count=0, ended=false;
    while (offset+12<=bytes.length && ++count<10000) {
      const length=v.getUint32(offset), type=ascii(bytes,offset+4,offset+8);
      if (length>MAX_FILE || offset+length+12>bytes.length) fail('Повреждена структура PNG.');
      offset+=length+12;
      if(type==='IEND'){if(length!==0 || offset!==bytes.length) fail('После PNG обнаружены посторонние данные.');ended=true;break;}
    }
    if(!ended) fail('PNG не завершён.');
    return size;
  }
  if (kind === 'jpeg') {
    if(bytes.length<4 || bytes.at(-2)!==0xff || bytes.at(-1)!==0xd9) fail('JPEG повреждён или содержит данные после конца изображения.');
    let offset=2;
    while(offset+4<bytes.length){
      if(bytes[offset++]!==0xff) fail('Повреждена структура JPEG.');
      while(bytes[offset]===0xff)offset++;
      const marker=bytes[offset++];
      if(marker===0xda || marker===0xd9)break;
      if(marker===0x01 || (marker>=0xd0&&marker<=0xd7))continue;
      const length=v.getUint16(offset);
      if(length<2 || offset+length>bytes.length) fail('Повреждена структура JPEG.');
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return dimensions(v.getUint16(offset+5),v.getUint16(offset+3));
      offset+=length;
    }
    fail('В JPEG не найдены размеры изображения.');
  }
  if(kind==='gif'){
    if(bytes.length<14 || bytes.at(-1)!==0x3b)fail('GIF повреждён или содержит посторонние данные.');
    return dimensions(v.getUint16(6,true),v.getUint16(8,true));
  }
  if(kind==='bmp'){
    if(bytes.length<54 || v.getUint32(2,true)!==bytes.length || v.getUint32(10,true)>=bytes.length)fail('Повреждена структура BMP.');
    if(v.getUint32(14,true)<40)fail('Эта версия BMP не поддерживается.');
    return dimensions(v.getInt32(18,true),Math.abs(v.getInt32(22,true)));
  }
  if(kind==='webp'){
    if(bytes.length<30 || v.getUint32(4,true)+8!==bytes.length)fail('Повреждена структура WebP.');
    const type=ascii(bytes,12,16);
    if(type==='VP8X')return dimensions(1+bytes[24]+bytes[25]*256+bytes[26]*65536,1+bytes[27]+bytes[28]*256+bytes[29]*65536);
    if(type==='VP8L' && bytes[20]===0x2f)return dimensions(1+((bytes[21]|bytes[22]<<8)&0x3fff),1+((bytes[22]>>6|bytes[23]<<2|bytes[24]<<10)&0x3fff));
    if(type==='VP8 ' && ascii(bytes,23,26)==='\x9d\x01\x2a')return dimensions(v.getUint16(26,true)&0x3fff,v.getUint16(28,true)&0x3fff);
    fail('Этот вариант WebP не поддерживается.');
  }
  if(kind==='tiff'){
    const little=ascii(bytes,0,2)==='II';
    const offset=v.getUint32(4,little);
    if(offset<8 || offset+2>bytes.length)fail('Повреждена структура TIFF.');
    const count=v.getUint16(offset,little);
    if(count>512 || offset+2+count*12+4>bytes.length)fail('Слишком сложная или повреждённая структура TIFF.');
    let width=0,height=0;
    for(let i=0;i<count;i++){
      const p=offset+2+i*12,tag=v.getUint16(p,little),type=v.getUint16(p+2,little),amount=v.getUint32(p+4,little);
      if(tag===256||tag===257){if(amount!==1 || ![3,4].includes(type))fail('Некорректные размеры TIFF.');const n=type===3?v.getUint16(p+8,little):v.getUint32(p+8,little);if(tag===256)width=n;else height=n;}
    }
    return dimensions(width,height);
  }
  // ISO-BMFF containers are decoded only by the resource-limited, terminable worker.
  if(kind==='avif'||kind==='heif'){
    let offset=0,boxes=0;
    while(offset<bytes.length && ++boxes<10000){
      if(offset+8>bytes.length)fail('Повреждён контейнер изображения.');
      let size=v.getUint32(offset),header=8;
      if(size===1){if(offset+16>bytes.length || v.getUint32(offset+8)!==0)fail('Слишком большой блок изображения.');size=v.getUint32(offset+12);header=16;}
      if(size===0)size=bytes.length-offset;
      if(size<header || offset+size>bytes.length)fail('Повреждён контейнер изображения.');
      offset+=size;
    }
    if(offset!==bytes.length)fail('Слишком сложный контейнер изображения.');
    return null;
  }
  return null;
}

export function checkBytes(file, bytes) {
  const kind=checkName(file.name,file.size);
  const actual=sniff(bytes);
  const office=['docx','xlsx','pptx','odt','ods','odp'].includes(kind);
  if(kind==='txt'){
    if(actual!=='unknown')fail('Содержимое файла не соответствует текстовому документу.');
  }else if((office&&actual!=='zip')||(!office&&actual!==kind))fail('Содержимое файла не соответствует его расширению. Переименование файла не меняет его формат.');
  if(!office&&!['pdf','txt'].includes(kind))checkImage(bytes,kind);
  if(kind==='pdf'){
    const tail=new TextDecoder('latin1').decode(bytes.subarray(Math.max(0,bytes.length-1024)));
    if(!/%%EOF[\x00\t\n\r\f ]*$/.test(tail))fail('PDF повреждён или содержит посторонние данные после конца документа.');
  }
  return kind;
}

export function zipDirectory(bytes) {
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--){if(v.getUint32(p,true)===0x06054b50 && p+22+v.getUint16(p+20,true)===bytes.length){end=p;break;}}
  if(end<0)fail('Повреждена структура офисного документа.');
  const count=v.getUint16(end+10,true),size=v.getUint32(end+12,true),start=v.getUint32(end+16,true);
  if(v.getUint16(end+4,true)||v.getUint16(end+6,true)||v.getUint16(end+8,true)!==count||count>1500||!count||start+size!==end)fail('Многотомные, ZIP64 и слишком сложные документы не поддерживаются.');
  let offset=start,total=0;
  const entries=new Map(),ranges=[];
  for(let i=0;i<count;i++){
    if(offset+46>end || v.getUint32(offset,true)!==0x02014b50)fail('Повреждён каталог офисного документа.');
    const flags=v.getUint16(offset+8,true),method=v.getUint16(offset+10,true),crc=v.getUint32(offset+16,true),compressed=v.getUint32(offset+20,true),original=v.getUint32(offset+24,true);
    const n=v.getUint16(offset+28,true),extra=v.getUint16(offset+30,true),comment=v.getUint16(offset+32,true),local=v.getUint32(offset+42,true);
    if(offset+46+n+extra+comment>end)fail('Повреждён каталог офисного документа.');
    let name;
    try{name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(offset+46,offset+46+n));}catch{fail('Некорректное имя части документа.');}
    if(!name || name.length>240 || /[\x00-\x1f\\:]/.test(name)||name.startsWith('/')||name.split('/').some(p=>p==='..'||p==='.')||entries.has(name))fail('Небезопасная структура офисного документа.');
    if(flags&0x2041 || ![0,8].includes(method))fail('Зашифрованные документы и этот тип сжатия не поддерживаются.');
    total+=original;
    if(original>16*1024*1024 || total>64*1024*1024 || original>Math.max(1024*1024,compressed*200))fail('Документ превышает ограничения на распаковку.');
    if(/(?:^|\/)(?:vba|activex|embeddings|externallinks|scripts|basic|macros)(?:\/|\.|$)|\.(?:exe|dll|js|vbs|bin|ole|wasm|jar|html?|svg)$/i.test(name))fail('Документ содержит макросы, вложенный код или активное содержимое.');
    if(local+30>start || v.getUint32(local,true)!==0x04034b50)fail('Повреждён блок офисного документа.');
    const ln=v.getUint16(local+26,true),le=v.getUint16(local+28,true),data=local+30+ln+le;
    if(v.getUint16(local+6,true)!==flags || v.getUint16(local+8,true)!==method || ascii(bytes,local+30,local+30+ln)!==name || data+compressed>start)fail('Несогласованная структура офисного документа.');
    ranges.push([local,data+compressed]);
    entries.set(name,{name,original,compressed,crc,method,data});
    offset+=46+n+extra+comment;
  }
  if(offset!==end)fail('Некорректный каталог документа.');
  ranges.sort((a,b)=>a[0]-b[0]);
  for(let i=1;i<ranges.length;i++)if(ranges[i][0]<ranges[i-1][1])fail('Части документа перекрываются.');
  return entries;
}
