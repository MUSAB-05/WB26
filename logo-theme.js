(() => {
  const logo=document.getElementById('teamLogo');if(!logo)return;
  const fallback='./icons/icon-512.png';
  function rgbToHsl(r,g,b){r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0,s=0,l=(max+min)/2;if(d){s=d/(1-Math.abs(2*l-1));switch(max){case r:h=60*(((g-b)/d)%6);break;case g:h=60*((b-r)/d+2);break;default:h=60*((r-g)/d+4);}if(h<0)h+=360;}return[h,s,l];}
  const hsl=(h,s,l)=>`hsl(${Math.round(h)} ${Math.round(s*100)}% ${Math.round(l*100)}%)`;
  function apply(){
    try{
      const c=document.createElement('canvas');c.width=72;c.height=72;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(logo,0,0,72,72);const d=ctx.getImageData(0,0,72,72).data,buckets=new Map();
      for(let i=0;i<d.length;i+=4){if(d[i+3]<160)continue;const r=d[i],g=d[i+1],b=d[i+2],[h,s,l]=rgbToHsl(r,g,b);if(l>.92||l<.08||s<.20)continue;const qr=Math.min(255,Math.round(r/32)*32),qg=Math.min(255,Math.round(g/32)*32),qb=Math.min(255,Math.round(b/32)*32),k=`${qr},${qg},${qb}`;buckets.set(k,(buckets.get(k)||0)+1);}
      const ranked=[...buckets.entries()].sort((a,b)=>b[1]-a[1]);if(!ranked.length)return;const[r,g,b]=ranked[0][0].split(',').map(Number),[h,s]=rgbToHsl(r,g,b),root=document.documentElement.style,ss=Math.max(.52,s);
      root.setProperty('--brand',hsl(h,ss,.58));root.setProperty('--brand-bright',hsl(h,Math.max(.55,s),.70));root.setProperty('--brand-soft',hsl(h,Math.max(.32,s*.7),.24));root.setProperty('--brand-deep',hsl(h,Math.max(.28,s*.6),.15));
      const light=document.documentElement.dataset.theme==='light';document.querySelector('meta[name="theme-color"]')?.setAttribute('content',light?'#eef0f4':'#252630');
    }catch(e){console.warn('Could not derive accent from logo:',e);}
  }
  logo.addEventListener('load',apply);logo.addEventListener('error',()=>{if(!logo.dataset.fallback){logo.dataset.fallback='1';logo.src=fallback;}});if(logo.complete&&logo.naturalWidth)apply();
})();
