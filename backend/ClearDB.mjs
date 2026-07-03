import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

await mongoose.connect(process.env.MONGODB_URI)
await mongoose.connection.db.collection('jobs').deleteMany({})
console.log('✅ Database cleared!')
await mongoose.disconnect()