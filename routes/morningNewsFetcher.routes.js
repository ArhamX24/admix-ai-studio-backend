import express from 'express'
import { getMorningNews, getMorningNewsTester } from '../controllers/morning-news-fetcher.js'

let morningNewsFetcherRouter = express.Router()


morningNewsFetcherRouter.post("/get-morning-news", getMorningNews)
.get("/test", getMorningNewsTester)

export default morningNewsFetcherRouter