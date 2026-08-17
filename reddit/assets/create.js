if(requireAuth()){
  const input=imageInput,zone=uploadZone;let imageData=null;
  function error(t){message.textContent=t;message.classList.remove("hidden","success")}
  function read(file){if(!file)return;if(!["image/jpeg","image/png","image/webp"].includes(file.type))return error("Only JPG, PNG and WEBP are supported.");if(file.size>1024*1024)return error("Image must be under 1 MB.");const r=new FileReader();r.onload=()=>{imageData=r.result;previewImage.src=imageData;previewBox.classList.remove("hidden");message.classList.add("hidden")};r.readAsDataURL(file)}
  chooseImage.onclick=()=>input.click();zone.onclick=e=>{if(e.target!==chooseImage)input.click()};input.onchange=()=>read(input.files[0]);removeImage.onclick=()=>{imageData=null;input.value="";previewBox.classList.add("hidden")};
  ["dragenter","dragover"].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.add("dragging")}));["dragleave","drop"].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.remove("dragging")}));zone.ondrop=e=>read(e.dataTransfer.files[0]);
  title.oninput=()=>titleCount.textContent=`${title.value.length} / 300`;content.oninput=()=>bodyCount.textContent=`${content.value.length} / 5000`;
  (async()=>{try{const cs=await api("/communities");community.innerHTML=cs.map(c=>`<option value="${c.id}">r/${esc(c.name)}</option>`).join("")}catch(e){error(e.message)}})();
  postForm.onsubmit=async e=>{e.preventDefault();try{const p=await api("/posts",{method:"POST",body:JSON.stringify({community_id:+community.value,title:title.value.trim(),content:content.value.trim(),image_data:imageData})});toast("Post published");setTimeout(()=>location.href=`/post.html?id=${p.id}`,220)}catch(x){error(x.message)}}
}
