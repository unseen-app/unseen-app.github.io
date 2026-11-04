import { MAX_PAGES } from './file-guard.mjs';

const fail = text => { throw new Error(text); };
const all = (node,name) => [...node.getElementsByTagNameNS('*',name)];
const clean = value => value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').slice(0,200000);
function xml(text){
  if(/<!DOCTYPE|<!ENTITY/i.test(text))fail('Документы с DTD и XML-сущностями не принимаются.');
  let tags=0,depth=0;
  for(const match of text.matchAll(/<[^>]*>/g)){
    const tag=match[0];if(++tags>60000)fail('Слишком сложная структура XML.');
    if(tag.startsWith('</'))depth--;else if(!tag.startsWith('<?')&&!tag.startsWith('<!')&&!tag.endsWith('/>'))depth++;
    if(depth>128)fail('Слишком глубокая вложенность XML.');
  }
  const doc=new DOMParser().parseFromString(text,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)fail('Повреждён XML внутри документа.');
  return doc;
}

export function textPages(text,title){
  if(text.length>200000)fail('Документ слишком длинный: максимум 200 000 символов.');
  const canvas=document.createElement('canvas'),c=canvas.getContext('2d');
  c.font='28px Golos,Arial,sans-serif';
  const lines=[];
  for(const paragraph of clean(text).replace(/\r\n?/g,'\n').split('\n')){
    let line='';
    for(const word of paragraph.split(/\s+/)){
      if(c.measureText(line+(line?' ':'')+word).width<=1050){line+=(line?' ':'')+word;continue;}
      if(line)lines.push(line);
      line='';
      for(const char of word){if(c.measureText(line+char).width>1050){lines.push(line);line='';}line+=char;}
    }
    lines.push(line);
  }
  const pages=[];
  for(let i=0;i<lines.length;i+=38){pages.push({title,lines:lines.slice(i,i+38)});if(pages.length>MAX_PAGES)fail('Документ превышает ограничение: 50 страниц предпросмотра.');}
  return pages.length?pages:[{title,lines:['Пустой документ']}];
}

export function renderTextPage(page,index,total){
  const canvas=document.createElement('canvas');canvas.width=1240;canvas.height=1754;
  const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,1240,1754);
  c.fillStyle='#737578';c.font='20px Golos,Arial,sans-serif';c.fillText(page.title.slice(0,70),90,74);
  c.strokeStyle='#e7e7e7';c.beginPath();c.moveTo(90,100);c.lineTo(1150,100);c.stroke();
  c.fillStyle='#252525';c.font='28px Golos,Arial,sans-serif';
  page.lines.forEach((line,i)=>c.fillText(line,90,155+i*39));
  c.fillStyle='#737578';c.font='19px Golos,Arial,sans-serif';c.fillText(`${index+1} / ${total}`,90,1700);
  return canvas;
}

export function openOffice(parts,kind){
  const entries=new Map(parts.names.map(name=>[name,true]));
  const cache=new Map(parts.texts);
  function read(name){
    if(cache.has(name))return cache.get(name);
    fail('В документе отсутствует обязательная часть или превышен размер XML.');
  }
  const odf=['odt','ods','odp'].includes(kind);
  const main={docx:'word/document.xml',xlsx:'xl/workbook.xml',pptx:'ppt/presentation.xml',odt:'content.xml',ods:'content.xml',odp:'content.xml'}[kind];
  if(!entries.has(main))fail('Содержимое офисного документа не соответствует расширению.');
  const root=xml(read(main)).documentElement;
  const roots={docx:'document',xlsx:'workbook',pptx:'presentation',odt:'document-content',ods:'document-content',odp:'document-content'};
  if(root.localName!==roots[kind])fail('Неверная структура основного документа.');
  const namespaces={docx:['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main'],xlsx:['http://schemas.openxmlformats.org/spreadsheetml/2006/main','http://purl.oclc.org/ooxml/spreadsheetml/main'],pptx:['http://schemas.openxmlformats.org/presentationml/2006/main','http://purl.oclc.org/ooxml/presentationml/main']};
  if(odf?root.namespaceURI!=='urn:oasis:names:tc:opendocument:xmlns:office:1.0':!namespaces[kind].includes(root.namespaceURI))fail('Не совпадает схема офисного документа.');
  if(odf){
    const expected={odt:'application/vnd.oasis.opendocument.text',ods:'application/vnd.oasis.opendocument.spreadsheet',odp:'application/vnd.oasis.opendocument.presentation'}[kind];
    if(!entries.has('mimetype')||read('mimetype').trim()!==expected)fail('Не совпадает тип OpenDocument.');
    if(entries.has('META-INF/manifest.xml')&&/encryption-data|algorithm-name/i.test(read('META-INF/manifest.xml')))fail('Зашифрованные документы не принимаются.');
  }else{
    if(!entries.has('[Content_Types].xml'))fail('Отсутствует описание типов документа.');
    const types=read('[Content_Types].xml');
    if(/macroEnabled|vbaProject|activeX|oleObject|javascript|html|svg\+xml/i.test(types))fail('Документ содержит макросы или активные вложения.');
    const expected={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'}[kind];
    if(!all(xml(types),'Override').some(item=>item.getAttribute('PartName')==='/'+main&&item.getAttribute('ContentType')===expected))fail('Тип основной части не соответствует документу.');
  }
  for(const name of entries.keys()){
    if(name.endsWith('.rels')){
      const relations=xml(read(name));
      for(const relation of all(relations,'Relationship')){
        if(relation.getAttribute('TargetMode')==='External'&&!/\/hyperlink$/.test(relation.getAttribute('Type')||''))fail('Документ с внешними ресурсами не принимается.');
      }
    }
  }
  const pages=[];
  const add=(text,title)=>{pages.push(...textPages(text,title));if(pages.length>MAX_PAGES)fail('Документ превышает ограничение: 50 страниц предпросмотра.');};
  if(kind==='docx'){
    const doc=xml(read(main));
    const paragraphs=all(doc,'p');
    if(paragraphs.length>6000)fail('Слишком сложный документ Word.');
    add(paragraphs.map(p=>all(p,'t').map(t=>t.textContent).join('')).join('\n'),'Word · текстовый предпросмотр');
  }else if(kind==='xlsx'){
    const shared=entries.has('xl/sharedStrings.xml')?all(xml(read('xl/sharedStrings.xml')),'si').map(si=>all(si,'t').map(t=>t.textContent).join('')):[];
    if(shared.length>20000)fail('Слишком большая таблица общих строк.');
    const sheets=[...entries.keys()].filter(name=>/^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    if(!sheets.length||sheets.length>50)fail('В книге должно быть от 1 до 50 листов.');
    for(const [index,name]of sheets.entries()){
      const doc=xml(read(name)),rows=all(doc,'row');
      if(rows.length>2000||all(doc,'c').length>20000)fail('Лист слишком большой для безопасного предпросмотра.');
      const lines=rows.map(row=>[...row.children].filter(c=>c.localName==='c').map(cell=>{
        const type=cell.getAttribute('t'),v=all(cell,'v')[0]?.textContent||'';
        if(type==='s'){const n=Number(v);return Number.isSafeInteger(n)&&n>=0&&n<shared.length?shared[n]:'';}
        if(type==='inlineStr')return all(cell,'t').map(t=>t.textContent).join('');
        return v; // Cached values only: formulas, links and DDE are never evaluated.
      }).join('    |    '));
      add(lines.join('\n'),`Excel · лист ${index+1} · значения ячеек`);
    }
  }else if(kind==='pptx'){
    const slides=[...entries.keys()].filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    if(!slides.length||slides.length>50)fail('В презентации должно быть от 1 до 50 слайдов.');
    for(const [index,name]of slides.entries())add(all(xml(read(name)),'p').map(p=>all(p,'t').map(t=>t.textContent).join('')).join('\n'),`PowerPoint · слайд ${index+1} · текст`);
  }else{
    const doc=xml(read(main));
    if(all(doc,'script').length || all(doc,'event-listener').length)fail('Документ содержит активное содержимое.');
    if(kind==='odt')add([...all(doc,'p'),...all(doc,'h')].map(p=>p.textContent).join('\n'),'OpenDocument · текстовый предпросмотр');
    if(kind==='ods'){
      const sheets=all(doc,'table');if(sheets.length>50)fail('Слишком много листов в таблице.');
      for(const [i,sheet]of sheets.entries()){
        const rows=all(sheet,'table-row');if(rows.length>2000)fail('Слишком большой лист.');
        add(rows.map(row=>all(row,'table-cell').map(cell=>all(cell,'p').map(p=>p.textContent).join(' ')).join('    |    ')).join('\n'),`OpenDocument · лист ${i+1}`);
      }
    }
    if(kind==='odp'){
      const slides=all(doc,'page');if(slides.length>50)fail('Слишком много слайдов.');
      for(const [i,slide]of slides.entries())add(all(slide,'p').map(p=>p.textContent).join('\n'),`OpenDocument · слайд ${i+1}`);
    }
  }
  if(!pages.length)add('Пустой документ','Предпросмотр');
  return {count:pages.length,note:'Текстовый предпросмотр. Для точной вёрстки загрузи PDF.',render:async index=>renderTextPage(pages[index],index,pages.length),dispose(){cache.clear();}};
}
