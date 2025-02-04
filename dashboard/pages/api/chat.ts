import { OpenAIPayload, OpenAIStream, generateText, huggingFaceStream, openaiCompletion } from '@/lib/utils'
import cors from '@/utils/cors'
import * as Sentry from '@sentry/nextjs'
import { defaultChatSystem } from '../../utils/constants'

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set')
}

export const config = {
  runtime: 'edge',
}
const track = async (userId: string, model: string) => {
  await fetch(
    'https://app.posthog.com/capture/',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: 'phc_plfzAimxHysKLaS80RK3NPaL0OJhlg983m3o5Zuukp',
        event: 'chat api',
        distinct_id: userId,
        properties: {
          model: model,
        },
      }),
    }
  )
}
type LLM = 'openai/gpt-4' | 'openai/gpt-3.5-turbo' | 'openai/gpt-3.5-turbo-16k' | 'tiiuae/falcon-7b' | 'google/bison' | 'bigscience/bloomz-7b1'


interface RequestPayload {
  prompt: string
  history: Chat[]
  system?: string
  model: LLM | string
  stream: boolean
  max_new_tokens?: number;
  stop?: string[];
}

export type Role = 'user' | 'system' | 'assistant'
type Chat = {
  role: Role
  content: string
}
const PROJECT_ID = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(
  'https://',
  ''
)?.replace('.supabase.co', '')

const getUserId = async (apiKey) => {
  // get the bearer token
  const split = apiKey.split(' ')
  if (split.length !== 2) {
    return new Response(JSON.stringify({ error: 'Invalid Api Key' }), {
      status: 401,
    })
  }

  const token = split[1]


  // HACK using https://$SUPABASE_PROJECT_ID.functions.supabase.co/consumeApi
  // supabase function instead of getting directly the ID in the db
  // because i couldn't make the supabase client work here
  try {
    const response = await fetch(
      `https://${PROJECT_ID}.functions.supabase.co/consumeApi`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }, // HACK is to use unknown as endpoint to not track twice the chat already tracked in apiMiddleware.ts
        // we just use the function to get the userId
        body: JSON.stringify({ apiKey: token, endpoint: 'unknown' }),
      }
    )
    // if we have a user id then we can continue
    if (!response.ok) {
      return response
    }
    const { userId } = await response.json()
    return userId
  } catch (error) {
    console.log(error)
    return new Response(JSON.stringify({ error: 'Invalid Api Key' }), {
      status: 401,
    })
  }

}

const handler = async (req: Request, res: Response): Promise<Response> => {
  let { prompt, history, system, model, stream, max_new_tokens, stop } = (await req.json()) as RequestPayload
  if (!model) model = 'openai/gpt-3.5-turbo'
  if (stream === undefined) stream = true
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'No prompt in the request' }), {
      status: 400,
    })
  }

  console.log('generating text with model', model, 'stream', stream, 'max_new_tokens', max_new_tokens)

  const messages: Chat[] = [
    {
      role: 'system',
      content: system || defaultChatSystem,
    },
    ...history || [],
    { role: 'user', content: prompt },
  ]

  //3. pass in the history of the conversation as well as the context (which is included in the prompt)
  const payload: OpenAIPayload = {
    model: 'gpt-3.5-turbo',
    messages,
    stream: true,
  }
  const apiKey = req.headers.get('Authorization')
  if (apiKey) {
    await getUserId(apiKey).then((userId) => track(userId, model).catch(console.error))
  }

  try {
    let readableStream: ReadableStream


    if (model === 'bigscience/bloomz-7b1') {
      const url = 'https://api.differentai.xyz'
      if (!stream) {
        const res = await generateText(url, {
          inputs: prompt,
          stream: false,
          parameters: {
            max_new_tokens: max_new_tokens || 1000,
            return_full_text: false,
            stop: stop || [],
          },
        })
        console.log('res', res)
        return new Response(JSON.stringify({
          generated_text: res
        }), {
          status: 200,
        })
      }
      // { model_id: "bigscience/bloomz-7b1", revision: None, sharded: None, num_shard: Some(1), quantize: None, trust_remote_code: false, max_concurrent_requests: 128, max_best_of: 2, max_stop_sequences: 4, max_input_length: 1000, max_total_tokens: 1512, max_batch_size: None, waiting_served_ratio: 1.2, max_batch_total_tokens: 32000, max_waiting_tokens: 20, port: 80, shard_uds_path: "/tmp/text-generation-server", master_addr: "localhost", master_port: 29500, huggingface_hub_cache: Some("/data"), weights_cache_override: None, disable_custom_kernels: false, json_output: false, otlp_endpoint: None, cors_allow_origin: [], watermark_gamma: None, watermark_delta: None, env: false 
      readableStream = await huggingFaceStream(url, {
        inputs: prompt,
        stream: true,
        parameters: {
          max_new_tokens: max_new_tokens || 1000,
          return_full_text: false,
          stop: stop || [],
        }
      })
    } else if (model === 'google/bison') {
      const url = 'https://llm-usx5gpslaq-uc.a.run.app'

      const res = await fetch(url, {
        method: 'POST',
        body: JSON.stringify({
          // TODO: support params
          prompt: prompt,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const data: { answer: string } = await res.json()
      return cors(
        req,
        new Response(JSON.stringify({
          generated_text: data.answer
        }), {
          status: 200,
        })
      )
    } else if (model === 'openai/gpt-4') {
      payload.model = 'gpt-4'
      if (!stream) {
        payload.stream = stream
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
          },
          method: 'POST',
          body: JSON.stringify(payload),
        }).then((res) => res.json())
        return new Response(JSON.stringify({
          generated_text: res?.choices?.[0]?.message.content || ''
        }), {
          status: 200,
        })
      }
      readableStream = await OpenAIStream(payload)
    } else if (model === 'openai/gpt-3.5-turbo-16k') {
      payload.model = 'gpt-3.5-turbo-16k'
      if (!stream) {
        payload.stream = stream
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
          },
          method: 'POST',
          body: JSON.stringify(payload),
        }).then((res) => res.json())
        return new Response(JSON.stringify({
          generated_text: res?.choices?.[0]?.message.content || ''
        }), {
          status: 200,
        })
      }
      readableStream = await OpenAIStream(payload)
    } else if (model === 'NousResearch/Nous-Hermes-13b') {
      const text = await openaiCompletion(
        'https://6976-35-203-131-148.ngrok-free.app', 'NousResearch/Nous-Hermes-13b', prompt, max_new_tokens || 100)
      return new Response(JSON.stringify({
        generated_text: text || ''
      }), {
        status: 200,
      })
    } else if (model === 'TheBloke/mpt-7b-chat-GGML') {
      const text = await openaiCompletion(
        'https://3e85-34-139-159-248.ngrok-free.app', 'TheBloke/mpt-7b-chat-GGML', prompt, max_new_tokens || 100)
      return new Response(JSON.stringify({
        generated_text: text || ''
      }), {
        status: 200,
      })
    } else if (model === 'TheBloke/Nous-Hermes-13B-GGML') {
      const text = await openaiCompletion(
        'https://28b6-2a01-e0a-3ee-1cb0-505a-5158-140c-80f8.ngrok-free.app', 'TheBloke/Nous-Hermes-13B-GGML', prompt, max_new_tokens || 100)
      return new Response(JSON.stringify({
        generated_text: text || ''
      }), {
        status: 200,
      })
    } else if (model === 'nomic-ai/ggml-replit-code-v1-3b') {
      const text = await openaiCompletion(
        'https://430699a51145-11712225068814657101.ngrok-free.app', 'nomic-ai/ggml-replit-code-v1-3b', prompt, max_new_tokens || 100)
      return new Response(JSON.stringify({
        generated_text: text || ''
      }), {
        status: 200,
      })
    } else {
      if (!stream) {
        payload.stream = stream
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
          },
          method: 'POST',
          body: JSON.stringify(payload),
        }).then((res) => res.json())
        return new Response(JSON.stringify({
          generated_text: res?.choices?.[0]?.message.content || ''
        }), {
          status: 200,
        })
      }
      readableStream = await OpenAIStream(payload)
    }
    return cors(
      req,
      new Response(readableStream, {
        status: 200,
      })
    )
  } catch (error) {
    console.error(error)
    Sentry.captureException(error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    })
  }
}
export default handler
