import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3'; import { Readable } from 'stream'; import crypto from 'crypto';
const bucket=process.env.S3_BUCKET_NAME||'securelearn-inbox';
const client=new S3Client({region:process.env.S3_REGION||'us-east-1',endpoint:process.env.S3_ENDPOINT,forcePathStyle:true,credentials:process.env.S3_ACCESS_KEY_ID?{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY||''}:undefined});
const detected=(b:Buffer)=>{if(b.subarray(0,4).toString()==='%PDF')return'application/pdf';if(b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return'image/jpeg';if(b[0]===0x89&&b.subarray(1,4).toString()==='PNG')return'image/png';if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return'image/webp';return'';};
export const sanitizeName=(v:string)=>v.normalize('NFKD').replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,180)||'attachment';
export const storeFile=async(ticketId:string,file:Express.Multer.File)=>{const mime=detected(file.buffer);if(!mime)throw new Error('Chỉ chấp nhận JPEG, PNG, WebP hoặc PDF.');const key=`inbox/${ticketId}/${crypto.randomUUID()}-${sanitizeName(file.originalname)}`;await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:file.buffer,ContentType:mime}));return{key,mime};};
export const getFile=async(key:string)=>{const r=await client.send(new GetObjectCommand({Bucket:bucket,Key:key}));return r.Body as Readable;};
export const deleteFile=async(key:string)=>client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));
export const storageReady=async()=>{try{await client.send(new HeadBucketCommand({Bucket:bucket}));return true}catch{return false}};
