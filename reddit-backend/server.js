require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json({ limit: '3mb' }));

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

function auth(req,res,next){
  const h=req.headers.authorization;
  if(!h||!h.startsWith('Bearer '))return res.status(401).json({error:'Unauthorized'});
  try{req.user=jwt.verify(h.split(' ')[1],process.env.JWT_SECRET);next()}
  catch{return res.status(401).json({error:'Invalid token'})}
}
function validateImage(image){
  if(image===undefined)return undefined;
  if(image===null||image==="")return null;
  if(!/^data:image\/(jpeg|png|webp);base64,/.test(image))throw new Error('Unsupported image format');
  if(image.length>1500000)throw new Error('Image is too large');
  return image;
}
async function getPost(id){
  const r=await pool.query(`
    SELECT p.id,p.title,p.content,p.image_data,p.created_at,
           u.id AS user_id,u.username,
           c.id AS community_id,c.name AS community,
           COALESCE(SUM(v.vote),0)::int AS score,
           COUNT(DISTINCT cm.id)::int AS comment_count
    FROM posts p
    JOIN users u ON u.id=p.user_id
    LEFT JOIN communities c ON c.id=p.community_id
    LEFT JOIN votes v ON v.post_id=p.id
    LEFT JOIN comments cm ON cm.post_id=p.id
    WHERE p.id=$1
    GROUP BY p.id,u.id,u.username,c.id,c.name
  `,[id]);
  return r.rows[0];
}

app.get('/',(req,res)=>res.json({message:'Clouddit Backend API',server:process.env.SERVER_NAME||'backend'}));
app.get('/health',(req,res)=>res.json({status:'healthy',server:process.env.SERVER_NAME||'backend'}));

app.post('/api/auth/register',async(req,res)=>{
  try{
    const {username,email,password}=req.body;
    if(!username||!email||!password)return res.status(400).json({error:'Missing fields'});
    const hash=await bcrypt.hash(password,10);
    const r=await pool.query(`INSERT INTO users(username,email,password_hash) VALUES($1,$2,$3) RETURNING id,username,email,created_at`,[username,email,hash]);
    res.status(201).json(r.rows[0]);
  }catch(e){
    if(e.code==='23505')return res.status(409).json({error:'Username or email already exists'});
    res.status(500).json({error:e.message});
  }
});

app.post('/api/auth/login',async(req,res)=>{
  try{
    const {username,password}=req.body;
    const r=await pool.query('SELECT * FROM users WHERE username=$1',[username]);
    if(!r.rows.length)return res.status(401).json({error:'Invalid username or password'});
    const u=r.rows[0];
    if(!await bcrypt.compare(password,u.password_hash))return res.status(401).json({error:'Invalid username or password'});
    const token=jwt.sign({id:u.id,username:u.username},process.env.JWT_SECRET,{expiresIn:'24h'});
    res.json({token,user:{id:u.id,username:u.username,email:u.email}});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/communities',async(req,res)=>{
  try{const r=await pool.query('SELECT * FROM communities ORDER BY name');res.json(r.rows)}
  catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/posts',async(req,res)=>{
  try{
    const r=await pool.query(`
      SELECT p.id,p.title,p.content,p.image_data,p.created_at,
             u.id AS user_id,u.username,
             c.id AS community_id,c.name AS community,
             COALESCE(SUM(v.vote),0)::int AS score,
             COUNT(DISTINCT cm.id)::int AS comment_count
      FROM posts p
      JOIN users u ON u.id=p.user_id
      LEFT JOIN communities c ON c.id=p.community_id
      LEFT JOIN votes v ON v.post_id=p.id
      LEFT JOIN comments cm ON cm.post_id=p.id
      GROUP BY p.id,u.id,u.username,c.id,c.name
      ORDER BY p.created_at DESC
    `);
    res.json(r.rows);
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/posts/:id',async(req,res)=>{
  try{
    const p=await getPost(req.params.id);
    if(!p)return res.status(404).json({error:'Post not found'});
    res.json(p);
  }catch(e){res.status(500).json({error:e.message})}
});

app.post('/api/posts',auth,async(req,res)=>{
  try{
    const {title,content,community_id}=req.body;
    if(!title)return res.status(400).json({error:'Title is required'});
    let image=null;try{image=validateImage(req.body.image_data)}catch(e){return res.status(400).json({error:e.message})}
    const r=await pool.query(`INSERT INTO posts(user_id,community_id,title,content,image_data) VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id,community_id||null,title,content||'',image]);
    res.status(201).json(r.rows[0]);
  }catch(e){res.status(500).json({error:e.message})}
});

app.patch('/api/posts/:id',auth,async(req,res)=>{
  try{
    const owned=await pool.query('SELECT * FROM posts WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);
    if(!owned.rows.length)return res.status(403).json({error:'You can edit only your own post'});
    const old=owned.rows[0];
    let image=old.image_data;
    if(req.body.image_data!==undefined){
      try{image=validateImage(req.body.image_data)}catch(e){return res.status(400).json({error:e.message})}
    }
    const r=await pool.query(`UPDATE posts SET title=$1,content=$2,image_data=$3 WHERE id=$4 AND user_id=$5 RETURNING *`,
      [req.body.title??old.title,req.body.content??old.content,image,req.params.id,req.user.id]);
    res.json(r.rows[0]);
  }catch(e){res.status(500).json({error:e.message})}
});

app.delete('/api/posts/:id',auth,async(req,res)=>{
  try{
    const r=await pool.query('DELETE FROM posts WHERE id=$1 AND user_id=$2 RETURNING id',[req.params.id,req.user.id]);
    if(!r.rows.length)return res.status(403).json({error:'You can delete only your own post'});
    res.json({deleted:true,id:r.rows[0].id});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/posts/:id/comments',async(req,res)=>{
  try{
    const r=await pool.query(`SELECT c.id,c.content,c.created_at,u.id AS user_id,u.username FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=$1 ORDER BY c.created_at ASC`,[req.params.id]);
    res.json(r.rows);
  }catch(e){res.status(500).json({error:e.message})}
});

app.post('/api/posts/:id/comments',auth,async(req,res)=>{
  try{
    if(!req.body.content)return res.status(400).json({error:'Comment content required'});
    const r=await pool.query(`INSERT INTO comments(post_id,user_id,content) VALUES($1,$2,$3) RETURNING *`,[req.params.id,req.user.id,req.body.content]);
    res.status(201).json(r.rows[0]);
  }catch(e){res.status(500).json({error:e.message})}
});

app.post('/api/posts/:id/vote',auth,async(req,res)=>{
  try{
    if(![1,-1].includes(req.body.vote))return res.status(400).json({error:'Vote must be 1 or -1'});
    await pool.query(`INSERT INTO votes(user_id,post_id,vote) VALUES($1,$2,$3) ON CONFLICT(user_id,post_id) DO UPDATE SET vote=EXCLUDED.vote`,
      [req.user.id,req.params.id,req.body.vote]);
    const r=await pool.query(`SELECT COALESCE(SUM(vote),0)::int AS score FROM votes WHERE post_id=$1`,[req.params.id]);
    res.json({score:r.rows[0].score});
  }catch(e){res.status(500).json({error:e.message})}
});

app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>{
  console.log(`${process.env.SERVER_NAME||'Backend'} running on port ${process.env.PORT||3000}`);
});
