import { FastMCP, imageContent } from "fastmcp";
import { GoogleGenAI, Modality } from "@google/genai";
import { z } from "zod";

const EnvSchema = z.object({
  GEMINI_API_KEY: z.string(),
  MCP_SECRET_TOKEN: z.string(),
  PORT: z.string().optional().transform(val => val ? parseInt(val) : 8080)
});

const env = EnvSchema.parse(process.env);

const genAI = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

const server = new FastMCP({
  name: "Family Guy Image Converter",
  version: "0.0.1",
  authenticate: async (request) => {
    const bearerToken = request.headers["authorization"]?.replace("Bearer ", "");

    if (bearerToken !== env.MCP_SECRET_TOKEN) {
      throw new Response(null, {
        status: 401,
        statusText: "Unauthorized - Invalid bearer token",
      });
    }

    return {
      authenticated: true
    }
  },
});

function base64ToBuffer(base64Data: string): Buffer {
  const cleanBase64 = base64Data.replace(/^data:image\/[a-z]+;base64,/, "");
  return Buffer.from(cleanBase64, "base64");
}

function getMimeTypeFromBase64(base64Data: string): string {
  if (base64Data.startsWith("data:")) {
    const match = base64Data.match(/^data:([^;]+);base64,/);
    return match?.[1] ?? "image/png";
  }
  return "image/png";
}

const ConvertToFamilyGuySchema = z.object({
  image_data: z.string().describe("Base64-encoded image data to convert to Family Guy style"),
  characterName: z.string().optional(),
  numberOfImages: z.number().min(1).max(4).optional().default(1),
});

server.addTool({
  name: "convertToFamilyGuy",
  description: "Convert an image to Family Guy character style using AI image generation. Takes a base64-encoded image and returns a Family Guy style version.",
  parameters: ConvertToFamilyGuySchema,
  execute: async (args) => {
    try {
      const validatedArgs = ConvertToFamilyGuySchema.parse(args);
      const { image_data, characterName, numberOfImages } = validatedArgs;

      const imageBuffer = base64ToBuffer(image_data);
      const mimeType = getMimeTypeFromBase64(image_data);

      const familyGuyPrompt = `Convert this image to Family Guy animated character style${characterName ? ` as ${characterName}` : ""}.

Family Guy style requirements:
- Simple, bold line art with thick black outlines
- Flat, solid colors with minimal shading  
- Exaggerated facial features and proportions
- Large, round eyes with small pupils
- Simple geometric shapes for body parts
- The distinctive Family Guy cartoon aesthetic
- Should look like it belongs in the Family Guy TV show
- High quality, detailed, professional cartoon illustration
- Maintain the same pose and composition as the original image

Style: Family Guy animated character, cartoon illustration, thick outlines, flat colors, exaggerated features`;

      const imageContents = [
        { text: familyGuyPrompt },
        {
          inlineData: {
            mimeType: mimeType,
            data: imageBuffer.toString("base64")
          }
        }
      ];

      if (numberOfImages === 1) {
        const imageResponse = await genAI.models.generateContent({
          model: "gemini-2.0-flash-preview-image-generation", 
          contents: imageContents,
          config: {
            responseModalities: [Modality.TEXT, Modality.IMAGE],
          }
        });

        if (imageResponse?.candidates?.[0]?.content?.parts) {
          for (const part of imageResponse.candidates[0].content.parts) {
            if (part.inlineData && part.inlineData.data && part.inlineData.mimeType?.startsWith('image/')) {
              return await imageContent({
                buffer: Buffer.from(part.inlineData.data, 'base64'),
              });
            }
          }
        }
      }

      const imageResponse = await genAI.models.generateContent({
        model: "gemini-2.0-flash-preview-image-generation", 
        contents: imageContents,
        config: {
          responseModalities: [Modality.TEXT, Modality.IMAGE],
        }
      });

      if (imageResponse?.candidates?.[0]?.content?.parts) {
        for (const part of imageResponse.candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.data && part.inlineData.mimeType?.startsWith('image/')) {
            return await imageContent({
              buffer: Buffer.from(part.inlineData.data, 'base64'),
            });
          }
        }
      }

      throw new Error("No image was generated");

    } catch (error) {
      console.error("Error converting to Family Guy style:", error);
      
      if (error instanceof z.ZodError) {
        const errorMessage = error.issues.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
        throw new Error(`Invalid input: ${errorMessage}`);
      }
      
      throw new Error(`Failed to convert image: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  },
});

server.start({
  transportType: "httpStream",
  httpStream: {
    port: env.PORT,
  },
});