const API="/api";
const esc=(v)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const getToken=()=>localStorage.getItem("token");
const getUser=()=>{try{return JSON.parse(localStorage.getItem("user")||"null")}catch{return null}};
function saveAuth(data){localStorage.setItem("token",data.token);localStorage.setItem("user",JSON.stringify(data.user))}
function logout(){localStorage.removeItem("token");localStorage.removeItem("user");location.href="/"}
function requireAuth(){if(!getToken()){location.href="/login.html";return false}return true}
async function api(path,opt={}){
  const headers={...(opt.headers||{})};
  if(opt.body&&!headers["Content-Type"])headers["Content-Type"]="application/json";
  if(getToken())headers.Authorization=`Bearer ${getToken()}`;
  const r=await fetch(API+path,{...opt,headers});
  let d={};try{d=await r.json()}catch{}
  if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
  return d;
}
function toast(msg,type="success"){
  let wrap=document.querySelector(".toast-wrap");if(!wrap){wrap=document.createElement("div");wrap.className="toast-wrap";document.body.appendChild(wrap)}
  const el=document.createElement("div");el.className=`toast ${type}`;el.textContent=msg;wrap.appendChild(el);
  setTimeout(()=>{el.style.opacity="0";el.style.transform="translateX(12px)"},2500);setTimeout(()=>el.remove(),2850)
}
function applyTheme(){document.documentElement.dataset.theme=localStorage.getItem("theme")||"light"}
function toggleTheme(){localStorage.setItem("theme",document.documentElement.dataset.theme==="dark"?"light":"dark");applyTheme()}
function savedIds(){return JSON.parse(localStorage.getItem("savedPosts")||"[]")}
function toggleSave(id){let ids=savedIds();ids=ids.includes(id)?ids.filter(x=>x!==id):[...ids,id];localStorage.setItem("savedPosts",JSON.stringify(ids));toast(ids.includes(id)?"Saved post":"Removed from saved");if(typeof loadPosts==="function")loadPosts();if(typeof loadSaved==="function")loadSaved()}
function isNew(post){return post.created_at&&(Date.now()-new Date(post.created_at).getTime())<86400000}
function readMins(t){const n=String(t||"").trim().split(/\s+/).filter(Boolean).length;return Math.max(1,Math.ceil(n/220))}
function sharePost(id){const url=`${location.origin}/post.html?id=${id}`;if(navigator.share)navigator.share({title:"Clouddit post",url}).catch(()=>{});else if(navigator.clipboard)navigator.clipboard.writeText(url).then(()=>toast("Post link copied"));else prompt("Copy this link:",url)}
function openLightbox(src){let b=document.getElementById("lightbox");if(!b){b=document.createElement("div");b.id="lightbox";b.className="lightbox";b.innerHTML='<button class="lightbox-close" onclick="closeLightbox()">×</button><img alt="Post image">';b.onclick=e=>{if(e.target===b)closeLightbox()};document.body.appendChild(b)}b.querySelector("img").src=src;requestAnimationFrame(()=>b.classList.add("open"))}
function closeLightbox(){document.getElementById("lightbox")?.classList.remove("open")}
function canEdit(post){const u=getUser();return !!u&&u.id===post.user_id}
function postCard(post){
  const saved=savedIds().includes(post.id);
  const image=post.image_data?`<div class="feed-image-wrap"><img class="feed-image" src="${post.image_data}" alt="${esc(post.title)}" onclick="openLightbox(this.src)"></div>`:"";
  return `<article class="card lift post-card">
    <div class="vote-panel"><button class="vote-btn" onclick="votePost(${post.id},1)">▲</button><div class="score">${esc(post.score)}</div><button class="vote-btn" onclick="votePost(${post.id},-1)">▼</button></div>
    <div class="post-main">
      <div class="post-badges">${isNew(post)?'<span class="pill new-badge">NEW</span>':""}<span class="pill">${readMins(post.content)} min read</span></div>
      <div class="meta">r/${esc(post.community||"general")} · Posted by u/${esc(post.username)}</div>
      <a href="/post.html?id=${post.id}"><h2 class="post-title">${esc(post.title)}</h2></a>
      <div class="post-content">${esc(post.content||"")}</div>${image}
      <div class="post-actions">
        <a class="action-link" href="/post.html?id=${post.id}">${esc(post.comment_count)} Comments</a>
        <button class="action-link ${saved?"saved":""}" onclick="toggleSave(${post.id})">${saved?"★ Saved":"☆ Save"}</button>
        <button class="action-link" onclick="sharePost(${post.id})">↗ Share</button>
        ${canEdit(post)?`<a class="action-link" href="/edit.html?id=${post.id}">✎ Edit</a>`:""}
      </div>
    </div></article>`;
}
async function votePost(id,value){if(!getToken()){location.href="/login.html";return}try{await api(`/posts/${id}/vote`,{method:"POST",body:JSON.stringify({vote:value})});toast(value===1?"Upvoted":"Downvoted");if(typeof loadPosts==="function")loadPosts();if(typeof loadPost==="function")loadPost()}catch(e){toast(e.message,"error")}}
function renderNav(){
  const u=getUser(),n=document.getElementById("navbar");if(!n)return;
  n.innerHTML=`<nav class="nav"><div class="nav-left"><a class="logo" href="/"><span class="logo-mark">C</span><span>Clouddit</span></a>
  <div class="nav-links"><a href="/">Home</a><a href="/communities.html">Communities</a><a href="/saved.html">Saved</a>${u?'<a href="/create.html">Create</a>':""}</div></div>
  <div class="nav-right"><button class="btn btn-soft btn-icon" onclick="toggleTheme()" title="Theme">◐</button>
  ${u?`<a class="btn btn-soft" href="/profile.html">u/${esc(u.username)}</a><button class="btn btn-primary" onclick="logout()">Logout</button>`:`<a class="btn btn-soft" href="/login.html">Log in</a><a class="btn btn-brand" href="/register.html">Sign up</a>`}</div></nav>`
}
function animateLinks(){document.addEventListener("click",e=>{const a=e.target.closest("a");if(!a||a.target==="_blank")return;const u=new URL(a.href,location.href);if(u.origin!==location.origin)return;e.preventDefault();document.body.classList.add("leaving");setTimeout(()=>location.href=u.href,150)})}
applyTheme();renderNav();animateLinks();requestAnimationFrame(()=>document.body.classList.add("ready"));
