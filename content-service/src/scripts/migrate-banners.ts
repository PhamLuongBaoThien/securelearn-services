import dotenv from 'dotenv';
import path from 'path';
import mongoose, { Schema } from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

const sourceUri = process.env.MONGO_URI_COURSE;
const targetUri = process.env.MONGO_URI_CONTENT;
if (!sourceUri || !targetUri) {
  throw new Error('Set both MONGO_URI_COURSE and MONGO_URI_CONTENT before running this migration.');
}

const schema = new Schema({}, { strict: false, collection: 'banners', timestamps: false });
const migrate = async () => {
  const source = await mongoose.createConnection(sourceUri).asPromise();
  const target = await mongoose.createConnection(targetUri).asPromise();
  try {
    const SourceBanner = source.model('Banner', schema);
    const TargetBanner = target.model('Banner', schema);
    const banners = await SourceBanner.find().lean();
    if (banners.length) {
      await TargetBanner.bulkWrite(banners.map((banner) => ({
        updateOne: { filter: { _id: banner._id }, update: { $setOnInsert: banner }, upsert: true },
      })));
    }
    const targetCount = await TargetBanner.countDocuments();
    console.log(`Banner migration complete: source=${banners.length}, target=${targetCount}`);
  } finally {
    await Promise.all([source.close(), target.close()]);
  }
};

void migrate().catch((error) => {
  console.error('Banner migration failed:', error);
  process.exit(1);
});
