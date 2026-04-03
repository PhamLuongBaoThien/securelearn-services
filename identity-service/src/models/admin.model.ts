import mongoose, { Schema, Document } from 'mongoose';

export interface IAdmin extends Document {
  email: string;
  password?: string;
  fullName: string;
  permissions: string[]; // VD: ['MANAGE_USERS', 'MANAGE_COURSES']
  createdAt: Date;
  updatedAt: Date;
}

const adminSchema: Schema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    permissions: [
      {
        type: String,
      },
    ],

  },
  {
    timestamps: true,
  }
);

export const Admin = mongoose.model<IAdmin>('Admin', adminSchema);
