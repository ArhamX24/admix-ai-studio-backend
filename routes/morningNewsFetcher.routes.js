import express from 'express'
import {
  getMorningNews,
  getMorningNewsTester,
  generateArticleSummary,
} from '../controllers/morning-news-fetcher.js'

let morningNewsFetcherRouter = express.Router()

morningNewsFetcherRouter
  .post("/get-morning-news", getMorningNews)
  .post("/generate-article-summary", generateArticleSummary)  
  .get("/test", getMorningNewsTester)

export default morningNewsFetcherRouter