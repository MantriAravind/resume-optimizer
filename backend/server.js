import express from 'express'
import cors from 'cors'

const app = express()
const PORT = 3001

app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
  res.json({ message: 'Resume Optimizer backend is running.' })
})

app.post('/optimize', (req, res) => {
  const { resumeText, jobText } = req.body

  if (!resumeText || !jobText) {
    return res.status(400).json({ error: 'Please provide both resume text and job description.' })
  }

  res.json({
    score: 72,
    optimizedResume: `This is a placeholder optimized version of your resume tailored to the job description. Resume length: ${resumeText.length} characters. Job description length: ${jobText.length} characters.`
  })
})

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`)
})