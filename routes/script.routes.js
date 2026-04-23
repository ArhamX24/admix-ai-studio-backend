import express from 'express'
import {
  getNewsById,
  generateScript,
  refineScript,
  saveGeneratedScript,
  getSavedScripts,
  deleteSavedScript
} from '../controllers/script.controllers.js'
import { authenticateToken } from '../middlewares/auth.middleware.js'


const scriptGeneratorRouter = express.Router()

// Get single news item by ID from DB
scriptGeneratorRouter.get('/news/:id', getNewsById)

// Generate anchor + voice over script from selected news IDs
scriptGeneratorRouter.post('/generate', generateScript)

// Refine script with AI chat
scriptGeneratorRouter.post('/refine', refineScript)

// Save final script to DB (requires auth)

scriptGeneratorRouter.post('/save', authenticateToken, saveGeneratedScript)   
scriptGeneratorRouter.get('/saved',authenticateToken, getSavedScripts)           
scriptGeneratorRouter.delete('/delete/:id', authenticateToken, deleteSavedScript) 

export default scriptGeneratorRouter