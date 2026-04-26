import { Router } from 'express'
import { getSessionUser } from '../auth'

export const meRouter = Router()

meRouter.get('/', async (req, res) => {
  const user = await getSessionUser(req)
  res.json({ user })
})
