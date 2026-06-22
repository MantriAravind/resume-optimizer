import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'

dotenv.config()

const app = express()
const PORT = 3001

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
  res.json({ message: 'Resume Optimizer backend is running.' })
})

app.post('/optimize', async (req, res) => {
  const { resumeText, jobText } = req.body

  if (!resumeText || !jobText) {
    return res.status(400).json({ 
      error: 'Please provide both resume text and job description.' 
    })
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: `You are an expert resume optimizer and ATS specialist. 

I will provide you with a resume and a job description. Your job is to:
1. Analyze how well the resume matches the job description
2. Give an ATS score out of 100 based on keyword match, relevance, and formatting
3. Rewrite the resume to better match the job description while keeping it honest and professional

Resume:
${resumeText}

Job Description:
${jobText}

Respond in this exact JSON format with no extra text:
{
  "score": <number between 0-100>,
  "feedback": "<2-3 sentences explaining the score>",
  "optimizedResume": "<the full rewritten resume>"
}`
        }
      ]
    })

    const responseText = message.content[0].text
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)

    res.json(parsed)

  } catch (error) {
    console.error('AI API error:', error)
    
    if (error.status === 401) {
      return res.status(401).json({ 
        error: 'Invalid API key. Please check your Anthropic API key.' 
      })
    }
    
    if (error.status === 402) {
      return res.status(402).json({ 
        error: 'No API credits remaining. Please add credits at console.anthropic.com.' 
      })
    }

    res.status(500).json({ 
      error: 'Something went wrong while optimizing your resume. Please try again.' 
    })
  }
})

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`)
})