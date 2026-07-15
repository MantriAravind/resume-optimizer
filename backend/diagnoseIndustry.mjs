import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()
await mongoose.connect(process.env.MONGODB_URI)
const coll = mongoose.connection.db.collection('jobs')
const bad = await coll.find({ company: { $in: ['Britive', 'Pearceservices', 'Coreweave'] } }).limit(3).toArray()
bad.forEach(j => console.log(`\n[${j.company}] industry:${j.industry}\n${j.description}\n---`))
await mongoose.disconnect()