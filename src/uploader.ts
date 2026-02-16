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

/**
 * Search the authenticated user's channel for a video tagged with the given SHA tag.
 * Returns the first matching video or null.
 */
export async function findVideoByShaTag(
  authClient: OAuth2Client,
  shaTag: string,
): Promise<{ videoId: string; url: string } | null> {
  const youtube = google.youtube({ version: 'v3', auth: authClient });

  // Search the user's own videos for the SHA tag string
  const searchRes = await youtube.search.list({
    forMine: true,
    type: ['video'],
    q: shaTag,
    part: ['snippet'],
    maxResults: 10,
  });

  const items = searchRes.data.items ?? [];
  if (items.length === 0) return null;

  // Verify the exact tag exists on the video (search is fuzzy)
  const videoIds = items.map(item => item.id?.videoId).filter(Boolean) as string[];
  if (videoIds.length === 0) return null;

  const videosRes = await youtube.videos.list({
    id: videoIds,
    part: ['snippet'],
  });

  for (const video of videosRes.data.items ?? []) {
    const tags = video.snippet?.tags ?? [];
    if (tags.includes(shaTag)) {
      return {
        videoId: video.id!,
        url: `https://youtu.be/${video.id}`,
      };
    }
  }

  return null;
}

/**
 * Check if a known video exists on YouTube and has the SHA tag.
 * If the video exists but lacks the tag, add it.
 * Returns: 'tagged' (tag was already there or just added), 'not_found' (video gone), or 'added' (tag was just added).
 */
export async function ensureVideoHasShaTag(
  authClient: OAuth2Client,
  videoId: string,
  shaTag: string,
): Promise<'tagged' | 'added' | 'not_found'> {
  const youtube = google.youtube({ version: 'v3', auth: authClient });

  const res = await youtube.videos.list({
    id: [videoId],
    part: ['snippet'],
  });

  const video = res.data.items?.[0];
  if (!video) return 'not_found';

  const tags = video.snippet?.tags ?? [];
  if (tags.includes(shaTag)) return 'tagged';

  // Add the SHA tag
  tags.push(shaTag);
  await youtube.videos.update({
    part: ['snippet'],
    requestBody: {
      id: videoId,
      snippet: {
        ...video.snippet,
        tags,
      },
    },
  });

  return 'added';
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
