import { checkImage, sniff, dimensions, MAX_FILE } from './file-guard.mjs';
import { ConfigurationFiles, ImageMagick, initializeImageMagick, MagickReadSettings, ResourceLimits } from './vendor/magick/dist/index.js';

// Decoder-only policy: no delegates, pseudo-formats, filters, disk cache or active formats.
ConfigurationFiles.default.policy.data = `<policymap>
<policy domain="delegate" rights="none" pattern="*"/><policy domain="filter" rights="none" pattern="*"/>
<policy domain="coder" rights="none" pattern="*"/>
<policy domain="coder" rights="read" pattern="{HEIC,AVIF,TIFF,JPEG,PNG,WEBP,GIF,BMP}"/>
<policy domain="path" rights="none" pattern="@*"/>
<policy domain="resource" name="memory" value="192MiB"/><policy domain="resource" name="map" value="0"/>
<policy domain="resource" name="disk" value="0"/><policy domain="resource" name="width" value="20000"/>
<policy domain="resource" name="height" value="20000"/><policy domain="resource" name="list-length" value="8"/>
<policy domain="resource" name="time" value="15"/><policy domain="system" name="max-memory-request" value="128MiB"/>
<policy domain="system" name="max-profile-size" value="2MiB"/></policymap>`;
let started = false;
self.onmessage = async event => {
  if (started) return;
  started = true;
  try {
    const { buffer, kind } = event.data || {};
    if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength || buffer.byteLength > MAX_FILE || !['heif','avif','tiff'].includes(kind)) throw new Error('Некорректный запрос декодирования.');
    const data = new Uint8Array(buffer);
    if (sniff(data) !== kind) throw new Error('Содержимое файла не соответствует формату.');
    checkImage(data, kind);
    await initializeImageMagick(new URL('./vendor/magick/dist/x86/magick.wasm', import.meta.url));
    ResourceLimits.memory = 192n * 1024n * 1024n;
    ResourceLimits.disk = 0n;
    ResourceLimits.listLength = 8n;
    ResourceLimits.time = 15n;
    const settings = new MagickReadSettings({ format: {heif:'HEIC',avif:'AVIF',tiff:'TIFF'}[kind], frameCount: 1, frameIndex: 0 });
    const result = ImageMagick.read(data, settings, image => {
      dimensions(image.width,image.height);
      image.autoOrient();
      const originalWidth=image.width, originalHeight=image.height;
      const scale=Math.min(1,4096/image.width,4096/image.height,Math.sqrt(6_000_000/(image.width*image.height)));
      if(scale<1)image.resize(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));
      const pixels=image.getPixels(p=>p.toByteArray(0,0,image.width,image.height,'RGBA'));
      if(!pixels)throw new Error('Не удалось декодировать изображение.');
      return {width:image.width,height:image.height,originalWidth,originalHeight,pixels};
    });
    self.postMessage({ok:true,...result},[result.pixels.buffer]);
  } catch(error) {
    self.postMessage({ok:false,error:'Не удалось открыть изображение: файл повреждён, слишком сложен или превышает ограничения декодера.'});
  }
};
