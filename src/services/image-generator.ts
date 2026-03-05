import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Supported aspect ratios for image generation
 */
export type AspectRatio = "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9" | "1:4" | "4:1" | "1:8" | "8:1";

/**
 * Service for generating and editing images using OpenRouter API
 */
export class ImageGenerator {
  private apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.OPENROUTER_API_KEY;
    if (!key) {
      throw new Error(
        "OpenRouter API key is required. Set OPENROUTER_API_KEY environment variable or provide it in constructor."
      );
    }
    this.apiKey = key;
  }

  /**
   * Generates an image based on a text prompt
   * @param prompt - Text description of the image to generate
   * @param outputPath - Optional path where the generated image will be saved
   * @param model - Model to use ('pro' or 'normal', default: 'pro')
   * @param referenceImagesPaths - Optional array of reference image paths
   * @param aspectRatio - Optional aspect ratio for the image (default: '16:9')
   * @returns Path to the generated image or base64 string if no output path provided
   */
  async generateImage(
    prompt: string,
    outputPath: string | undefined,
    _model: "pro" | "normal" = "pro", // model parameter ignored since we use a fixed model
    referenceImagesPaths?: string[],
    aspectRatio: AspectRatio = "16:9"
  ): Promise<string> {
    const modelName = "google/gemini-3.1-flash-image-preview";

    // Build messages array
    const content: any[] = [
      { type: "text", text: prompt }
    ];

    // Add reference images if provided
    if (referenceImagesPaths && referenceImagesPaths.length > 0) {
      for (const imagePath of referenceImagesPaths) {
        const imageData = this.readImageAsBase64(imagePath);
        const mimeType = this.getMimeType(imagePath);
        content.push({
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${imageData}`
          }
        });
      }
    }

    const payload = {
      model: modelName,
      messages: [
        {
          role: "user",
          content: content
        }
      ],
      modalities: ["image"],
      image_config: { aspect_ratio: aspectRatio }
    };

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://github.com/choesumin/nanobanana-api-mcp", // Required by OpenRouter
        "X-Title": "Nanobanana API MCP" // Required by OpenRouter
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data: any = await response.json();

    // Extract image from response. OpenRouter returns images in message.images or content
    const choice = data.choices?.[0];
    if (!choice || !choice.message) {
      throw new Error("Invalid response structure from OpenRouter");
    }

    let base64Image: string | null = null;

    // Check content text for image data url (some models return it this way)
    if (choice.message.content && choice.message.content.includes("data:image")) {
      const match = choice.message.content.match(/data:image\/[^;]+;base64,([a-zA-Z0-9+/=]+)/);
      if (match && match[1]) {
        base64Image = match[1];
      }
    }

    // Some models return in images array or message.images
    if (!base64Image && choice.message.images && choice.message.images.length > 0) {
      const img = choice.message.images[0];
      if (typeof img === 'string') {
        if (img.startsWith("data:image")) {
          base64Image = img.split(",")[1];
        } else {
          base64Image = img; // Assume base64
        }
      } else if (img && typeof img === 'object' && img.image_url && img.image_url.url) {
        const url = img.image_url.url;
        if (url.startsWith("data:image")) {
          base64Image = url.split(",")[1];
        } else {
          base64Image = url; 
        }
      } else if (img && typeof img === 'object' && img.url) {
        if (img.url.startsWith("data:image")) {
          base64Image = img.url.split(",")[1];
        } else {
          base64Image = img.url; 
        }
      }
    }

    // fallback to checking generic content
    if (!base64Image && typeof choice.message.content === "string") {
       // if the content itself is just the base64 or url
       if (choice.message.content.startsWith("data:image")) {
         base64Image = choice.message.content.split(",")[1];
       } else if (/^[a-zA-Z0-9+/]+={0,2}$/.test(choice.message.content.trim())) {
         base64Image = choice.message.content.trim();
       }
    }

    if (!base64Image) {
       console.error("OpenRouter response data:", JSON.stringify(data, null, 2));
       throw new Error("No image data found in the OpenRouter response");
    }

    // If no output path provided, return base64 string
    if (!outputPath) {
      return base64Image;
    }

    // Otherwise save to file
    const buffer = Buffer.from(base64Image, "base64");

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  }

  /**
   * Edits an existing image based on a text prompt
   * @param imageInput - Path to the image or base64 string with mime type
   * @param prompt - Text description of the edits to make
   * @param outputPath - Optional path where the edited image will be saved
   * @param model - Model to use ('pro' or 'normal', default: 'pro')
   * @param referenceImagesPaths - Optional array of additional reference image paths
   * @param aspectRatio - Optional aspect ratio for the edited image (default: '16:9')
   * @returns Path to the edited image or base64 string if no output path provided
   */
  async editImage(
    imageInput: string | { base64: string; mimeType: string },
    prompt: string,
    outputPath?: string,
    _model: "pro" | "normal" = "pro", // model parameter ignored since we use a fixed model
    referenceImagesPaths?: string[],
    aspectRatio: AspectRatio = "16:9"
  ): Promise<string> {
    const modelName = "google/gemini-3.1-flash-image-preview";

    // Determine if input is path or base64
    let imageData: string;
    let mimeType: string;

    if (typeof imageInput === "string") {
      // Path input
      imageData = this.readImageAsBase64(imageInput);
      mimeType = this.getMimeType(imageInput);
    } else {
      // Base64 input
      imageData = imageInput.base64;
      mimeType = imageInput.mimeType;
    }

    // Build contents array with the image to edit
    const content: any[] = [
      { type: "text", text: prompt },
      {
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${imageData}`
        }
      }
    ];

    // Add additional reference images if provided
    if (referenceImagesPaths && referenceImagesPaths.length > 0) {
      for (const refImagePath of referenceImagesPaths) {
        const refImageData = this.readImageAsBase64(refImagePath);
        const refMimeType = this.getMimeType(refImagePath);
        content.push({
          type: "image_url",
          image_url: {
            url: `data:${refMimeType};base64,${refImageData}`
          }
        });
      }
    }

    const payload = {
      model: modelName,
      messages: [
        {
          role: "user",
          content: content
        }
      ],
      modalities: ["image"],
      image_config: { aspect_ratio: aspectRatio }
    };

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://github.com/choesumin/nanobanana-api-mcp", // Required by OpenRouter
        "X-Title": "Nanobanana API MCP" // Required by OpenRouter
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data: any = await response.json();

    // Extract and save the edited image
    const choice = data.choices?.[0];
    if (!choice || !choice.message) {
      throw new Error("Invalid response structure from OpenRouter");
    }

    let base64Image: string | null = null;

    // Check content text for image data url (some models return it this way)
    if (choice.message.content && choice.message.content.includes("data:image")) {
      const match = choice.message.content.match(/data:image\/[^;]+;base64,([a-zA-Z0-9+/=]+)/);
      if (match && match[1]) {
        base64Image = match[1];
      }
    }

    // Some models return in images array or message.images
    if (!base64Image && choice.message.images && choice.message.images.length > 0) {
      const img = choice.message.images[0];
      if (typeof img === 'string') {
        if (img.startsWith("data:image")) {
          base64Image = img.split(",")[1];
        } else {
          base64Image = img; // Assume base64
        }
      } else if (img && typeof img === 'object' && img.image_url && img.image_url.url) {
        const url = img.image_url.url;
        if (url.startsWith("data:image")) {
          base64Image = url.split(",")[1];
        } else {
          base64Image = url; 
        }
      } else if (img && typeof img === 'object' && img.url) {
        if (img.url.startsWith("data:image")) {
          base64Image = img.url.split(",")[1];
        } else {
          base64Image = img.url; 
        }
      }
    }

    // fallback to checking generic content
    if (!base64Image && typeof choice.message.content === "string") {
       // if the content itself is just the base64 or url
       if (choice.message.content.startsWith("data:image")) {
         base64Image = choice.message.content.split(",")[1];
       } else if (/^[a-zA-Z0-9+/]+={0,2}$/.test(choice.message.content.trim())) {
         base64Image = choice.message.content.trim();
       }
    }

    if (!base64Image) {
       console.error("OpenRouter response data:", JSON.stringify(data, null, 2));
       throw new Error("No image data found in the OpenRouter response");
    }

    // If no output path provided, return base64 string
    if (!outputPath) {
      return base64Image;
    }

    // Otherwise save to file
    const buffer = Buffer.from(base64Image, "base64");

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  }

  /**
   * Reads an image file and converts it to base64
   * @param imagePath - Path to the image file
   * @returns Base64 encoded string
   */
  private readImageAsBase64(imagePath: string): string {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image file not found: ${imagePath}`);
    }
    const imageBuffer = fs.readFileSync(imagePath);
    return imageBuffer.toString("base64");
  }

  /**
   * Determines MIME type based on file extension
   * @param filePath - Path to the file
   * @returns MIME type string
   */
  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
    };
    return mimeTypes[ext] || "image/jpeg";
  }
}
