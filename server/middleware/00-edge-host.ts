import { defineEventHandler } from 'h3'
import { captureEdgeHost } from '~/server/utils/effectiveHost'

export default defineEventHandler(event => { captureEdgeHost(event) })
