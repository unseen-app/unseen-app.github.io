import { ACCEPT, MAX_FILE, MAX_PAGES, checkName, checkBytes, dimensions } from './file-guard.mjs';
export { ACCEPT };
const fail = text => { throw new Error(text); };
const hasEntries = value => !!value && (value instanceof Map || value instanceof Set ? value.size > 0 : Object.keys(value).length > 0);

function deadline(promise, milliseconds, cleanup=()=>{}) {
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{cleanup();reject(new Error('Обработка остановлена по времени. Выбери файл меньшего размера или сложности.'));},milliseconds);});
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}

function runWorker(script, bytes, kind, signal) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(script,import.meta.url),{type:'module'});
    let timer;
    const finish=(error,result)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(result);};
    const abort=()=>finish(new DOMException('Отменено','AbortError'));
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return;}
    timer=setTimeout(()=>finish(new Error('Обработка остановлена по времени. Файл слишком сложный или повреждён.')),script==='media-worker.mjs'?60000:15000);
    worker.onerror=()=>finish(new Error('Не удалось запустить обработчик формата. Обнови страницу или попробуй другой файл.'));
    worker.onmessage=event=>{const result=event.data;if(!result||typeof result.ok!=='boolean'){finish(new Error('Некорректный ответ обработчика.'));return;}finish(result.ok?null:new Error(result.error||'Файл отклонён обработчиком.'),result);};
    worker.postMessage({buffer:bytes.buffer,kind},[bytes.buffer]);
  });
}

async function openPdf(bytes,signal) {
  const pdf=await import('./vendor/pdfjs/build/pdf.mjs');
  pdf.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/build/pdf.worker.mjs',import.meta.url).href;
  const task=pdf.getDocument({data:bytes,isEvalSupported:false,enableXfa:false,stopAtErrors:true,disableAutoFetch:true,disableStream:true,disableRange:true,useWasm:true,maxImageSize:40_000_000,disableFontFace:true,
    cMapUrl:new URL('./vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,
    standardFontDataUrl:new URL('./vendor/pdfjs/standard_fonts/',import.meta.url).href,
    wasmUrl:new URL('./vendor/pdfjs/wasm/',import.meta.url).href});
  const abort=()=>{task.destroy().catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted){abort();throw new DOMException('Отменено','AbortError');}
  let password=false;
  task.onPassword=()=>{password=true;abort();};
  try{
    const doc=await deadline(task.promise,20000,abort);
    if(doc.numPages<1||doc.numPages>MAX_PAGES)fail('PDF должен содержать от 1 до 50 страниц.');
    const [js,hasJS,attachments,action]=await deadline(Promise.all([doc.getJSActions(),doc.hasJSActions(),doc.getAttachments(),doc.getOpenAction()]),15000,abort);
    const actionType=action instanceof Map?action.get('action'):action?.action;
    if(hasEntries(js)||hasJS||hasEntries(attachments)||actionType)fail('PDF с JavaScript, активными действиями или вложенными файлами не принимается.');
    for(let i=1;i<=doc.numPages;i++){
      const page=await deadline(doc.getPage(i),10000,abort);
      const js=await deadline(page.getJSActions(),10000,abort);
      if(hasEntries(js))fail('PDF содержит встроенный JavaScript.');
    }
    return {count:doc.numPages,note:'PDF · сохраняется текущая страница. Маски каждой страницы хранятся отдельно.',
      async render(index){
        const page=await deadline(doc.getPage(index+1),10000,abort);
        const base=page.getViewport({scale:1});
        if(!Number.isFinite(base.width)||!Number.isFinite(base.height)||base.width<=0||base.height<=0||base.width>20000||base.height>20000)fail('Размер страницы PDF превышает ограничения.');
        const operators=await deadline(page.getOperatorList(),15000,abort);
        if(operators.fnArray.length>100000)fail('Страница PDF слишком сложна для обработки на устройстве.');
        const scale=Math.min(2,4096/base.width,4096/base.height,Math.sqrt(6_000_000/(base.width*base.height)));
        const viewport=page.getViewport({scale});
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(viewport.width));canvas.height=Math.max(1,Math.floor(viewport.height));
        const render=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'#ffffff',annotationMode:pdf.AnnotationMode.ENABLE});
        await deadline(render.promise,20000,()=>{render.cancel();abort();});
        return canvas;
      },dispose(){signal?.removeEventListener('abort',abort);abort();}};
  }catch(error){abort();signal?.removeEventListener('abort',abort);if(password)fail('PDF защищён паролем. Зашифрованные файлы не принимаются.');throw error;}
}

export async function prepareFile(file,signal) {
  checkName(file.name,file.size);
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(signal?.aborted)throw new DOMException('Отменено','AbortError');
  if(bytes.length!==file.size||bytes.length>MAX_FILE)fail('Не удалось прочитать файл целиком.');
  const kind=checkBytes(file,bytes);
  if(kind==='pdf')return openPdf(bytes,signal);
  if(['docx','xlsx','pptx','odt','ods','odp'].includes(kind)){
    const parts=await runWorker('office-worker.mjs',bytes,kind,signal);
    const office=await import('./office.mjs');
    return office.openOffice(parts,kind);
  }
  if(kind==='txt'){
    let encoding='utf-8';
    if(bytes[0]===255&&bytes[1]===254)encoding='utf-16le';
    if(bytes[0]===254&&bytes[1]===255)encoding='utf-16be';
    let text;try{text=new TextDecoder(encoding,{fatal:true}).decode(bytes);}catch{fail('TXT должен быть в UTF-8 или UTF-16. Бинарные файлы не принимаются.');}
    if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)||/^\s*(?:#!|<\?(?:php|xml)|<!doctype|<html\b|<script\b|(?:import|export)\s|(?:const|let|var)\s+\w+\s*=|function\s+\w+\s*\()/i.test(text))fail('Этот TXT похож на код, разметку или бинарный файл. Он не принимается.');
    const office=await import('./office.mjs'),pages=office.textPages(text,'Текстовый документ');
    return {count:pages.length,note:'Текстовый предпросмотр · сохраняется текущая страница.',render:async index=>office.renderTextPage(pages[index],index,pages.length),dispose(){}};
  }
  if(['heif','avif','tiff'].includes(kind)){
    const result=await runWorker('media-worker.mjs',bytes,kind,signal);
    dimensions(result.width,result.height);
    if(!(result.pixels instanceof Uint8Array)||result.pixels.length!==result.width*result.height*4)fail('Некорректный результат декодирования.');
    const canvas=document.createElement('canvas');canvas.width=result.width;canvas.height=result.height;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(result.pixels.buffer),result.width,result.height),0,0);
    const resized=result.originalWidth!==result.width||result.originalHeight!==result.height?`Уменьшено с ${result.originalWidth} × ${result.originalHeight} до ${result.width} × ${result.height}. `:'';
    return {count:1,note:resized+(kind==='tiff'?'TIFF · открыто первое изображение.':'Фото обработано локально.'),render:async()=>canvas,dispose(){canvas.width=1;canvas.height=1;}};
  }
  const blob=new Blob([bytes],{type:{jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',bmp:'image/bmp'}[kind]});
  let image,url;
  try{
    if('createImageBitmap'in window)image=await deadline(createImageBitmap(blob,{imageOrientation:'from-image'}),15000);
    else{url=URL.createObjectURL(blob);image=new Image();image.src=url;await deadline(image.decode(),15000);}
    dimensions(image.width,image.height);
    return {count:1,note:kind==='gif'?'GIF · открыт первый кадр.':'',render:async()=>image,dispose(){image?.close?.();if(url)URL.revokeObjectURL(url);}};
  }catch(error){image?.close?.();if(url)URL.revokeObjectURL(url);throw new Error('Не удалось открыть изображение. Файл повреждён или не поддерживается браузером.');}
}

export async function rasterPdf(canvas) {
  const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));
  if(!jpeg)fail('Не удалось подготовить PDF.');
  const data=new Uint8Array(await jpeg.arrayBuffer());
  const encoder=new TextEncoder(),parts=[],offsets=[0];let length=0;
  const push=value=>{const bytes=typeof value==='string'?encoder.encode(value):value;parts.push(bytes);length+=bytes.length;};
  const object=(id,text)=>{offsets[id]=length;push(`${id} 0 obj\n${text}\nendobj\n`);};
  const w=canvas.width*.75,h=canvas.height*.75;
  push('%PDF-1.4\n%Unseen raster copy\n');
  object(1,'<< /Type /Catalog /Pages 2 0 R >>');
  object(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4]=length;push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>\nstream\n`);push(data);push('\nendstream\nendobj\n');
  const content=`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`;object(5,`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
  const xref=length;push('xref\n0 6\n0000000000 65535 f \n');
  for(let i=1;i<=5;i++)push(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts,{type:'application/pdf'});
}
