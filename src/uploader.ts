import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { createReadStream, statSync } from 'fs';

export interface UploadOptions {
  videoPath: string;
  title: string;
  description: string;
  privacy: 'public' | 'unlisted' | 'private';
  categoryId: string;
  tags: string[];
}

export interface UploadResult {
  videoId: string;
  url: string;
}

export async function uploadToYouTube(
  authClient: OAuth2Client,
  options: UploadOptions,
): Promise<UploadResult> {
  const youtube = google.youtube({ version: 'v3', auth: authClient });
  const fileSize = statSync(options.videoPath).size;

  console.log(`\n  Uploading: ${options.videoPath}`);
  console.log(`  Size:      ${(fileSize / 1048576).toFixed(1)} MB`);
  console.log(`  Title:     ${options.title}`);
  console.log(`  Privacy:   ${options.privacy}\n`);

  const res = await youtube.videos.insert(
    {
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: options.title,
          description: options.description,
          tags: options.tags,
          categoryId: options.categoryId,
        },
        status: {
          privacyStatus: options.privacy,
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: createReadStream(options.videoPath),
      },
    },
    {
      onUploadProgress: (evt: { bytesRead: number }) => {
        const pct = ((evt.bytesRead / fileSize) * 100).toFixed(1);
        const mb = (evt.bytesRead / 1048576).toFixed(1);
        process.stdout.write(`\r  Uploading: ${pct}% (${mb} MB)    `);
      },
    },
  );

  const videoId = res.data.id!;
  const url = `https://youtu.be/${videoId}`;

  process.stdout.write('\n');
  console.log(`\n  Upload complete!`);
  console.log(`  Video URL: ${url}\n`);

  return { videoId, url };
}
