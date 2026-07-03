import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

await mongoose.connect(process.env.MONGODB_URI)

const doc = await mongoose.connection.db
  .collection('jobs')
  .findOne({ id: '4109933009' })

console.log('TITLE:', doc.title)
console.log()
console.log('FULL DESCRIPTION:')
console.log(doc.description)

await mongoose.disconnect()