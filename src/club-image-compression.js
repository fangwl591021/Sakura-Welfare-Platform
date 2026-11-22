// Run one image at a time on the client before sending any bytes to R2.
export async function compressClubPhoto(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('請選擇 JPG、PNG 或 WebP 照片；HEIC 請先轉成 JPG。');
  if (!file.size || file.size > 30_000_000) throw new Error('原始照片須小於 30 MB。');
  const url=URL.createObjectURL(file),image=new Image();
  let canvas;
  try {
    image.src=url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth*image.naturalHeight>40_000_000) throw new Error('照片尺寸過大，請先縮小圖片。');
    const scale=Math.min(1,1920/Math.max(image.naturalWidth,image.naturalHeight));
    canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('此瀏覽器無法壓縮照片。');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    let blob;
    for(const quality of [.8,.65,.5]){
      blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
      if(!blob||blob.type!=='image/jpeg')throw new Error('照片壓縮失敗，請更換瀏覽器或圖片。');
      if(blob.size<=1_500_000)break;
    }
    if(blob.size>1_500_000)throw new Error('壓縮後照片仍過大，請先縮小圖片。');
    return new File([blob],file.name.replace(/\.[^.]+$/,'').slice(0,180)+'.jpg',{type:'image/jpeg'});
  } finally { URL.revokeObjectURL(url);image.src='';if(canvas){canvas.width=1;canvas.height=1;} }
}
