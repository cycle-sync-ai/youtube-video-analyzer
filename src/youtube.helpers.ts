import ytdl from "@distube/ytdl-core";
import * as fs from "fs";
import * as path from "path";
import ffmpeg from "fluent-ffmpeg";
import axios from 'axios';
import * as cheerio from 'cheerio';

const CHANNEL_URL = 'https://www.youtube.com/c/OndřejKoběrský/videos'; // Channel videos page  
const TWO_YEARS_AGO = new Date();
TWO_YEARS_AGO.setFullYear(TWO_YEARS_AGO.getFullYear() - 2);

export async function downloadVideo(
  videoUrl: string
): Promise<{ audioPath: string; videoId: string }> {
  try {
    const videoInfo = await ytdl.getInfo(videoUrl);
    const videoId = videoInfo.videoDetails.videoId;

    // Ensure data directory exists
    const dataDir = path.join(__dirname, "..", "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const audioPath = path.join(dataDir, `${videoId}.mp3`);

    // check if the file already exists
    if (fs.existsSync(audioPath)) {
      console.log(`Audio file already exists for ${videoId}`);
      return { audioPath, videoId };
    }

    return new Promise((resolve, reject) => {
      const stream = ytdl(videoUrl, {
        quality: "highestaudio",
        filter: "audioonly",
      });

      // Handle stream errors
      stream.on("error", (error) => {
        console.error("Stream error:", error);
        reject(error);
      });

      // Handle progress
      let lastPercent = 0;
      stream.on("progress", (_, downloaded, total) => {
        const percent = Math.floor((downloaded / total) * 100);
        if (percent > lastPercent) {
          lastPercent = percent;
          console.log(`Downloading: ${percent}%`);
        }
      });

      const writeStream = fs.createWriteStream(audioPath);

      writeStream.on("error", (error) => {
        console.error("Write stream error:", error);
        reject(error);
      });

      stream
        .pipe(writeStream)
        .on("finish", () => {
          console.log(`Successfully downloaded audio to ${audioPath}`);
          resolve({ audioPath, videoId });
        })
        .on("error", (error) => {
          console.error("Pipe error:", error);
          reject(error);
        });
    });
  } catch (error) {
    console.error("Error in downloadVideo:", error);
    throw error;
  }
}

export async function downloadVideoInChunks(
  videoUrl: string,
  chunkDurationMinutes: number = 1
): Promise<{ chunksDir: string; videoId: string }> {
  try {
    const videoInfo = await ytdl.getInfo(videoUrl);
    const videoId = videoInfo.videoDetails.videoId;
    const videoDurationSeconds = parseInt(videoInfo.videoDetails.lengthSeconds);

    // Create directory for chunks
    const dataDir = path.join(__dirname, "..", "data");
    const chunksDir = path.join(dataDir, videoId);
    if (!fs.existsSync(chunksDir)) {
      fs.mkdirSync(chunksDir, { recursive: true });
    }

    // First download the complete audio file
    const tempAudioPath = path.join(chunksDir, `complete.mp3`);

    if (!fs.existsSync(tempAudioPath)) {
      await new Promise((resolve, reject) => {
        const stream = ytdl(videoUrl, {
          quality: "highestaudio",
          filter: "audioonly",
        });

        const writeStream = fs.createWriteStream(tempAudioPath);

        stream.pipe(writeStream).on("finish", resolve).on("error", reject);
      });
    }

    // Calculate number of chunks
    const chunkDurationSeconds = chunkDurationMinutes * 60;
    const numberOfChunks = Math.ceil(
      videoDurationSeconds / chunkDurationSeconds
    );

    // Split into chunks using ffmpeg
    const splitPromises = Array.from({ length: numberOfChunks }, (_, index) => {
      const startTime = index * chunkDurationSeconds;
      const chunkPath = path.join(chunksDir, `${index}.mp3`);

      // Skip if chunk already exists
      if (fs.existsSync(chunkPath)) {
        console.log(`Chunk ${index} already exists`);
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        ffmpeg(tempAudioPath)
          .setStartTime(startTime)
          .setDuration(chunkDurationSeconds)
          .output(chunkPath)
          .on("end", () => {
            console.log(`Chunk ${index} created successfully`);
            resolve(null);
          })
          .on("error", (err) => {
            console.error(`Error creating chunk ${index}:`, err);
            reject(err);
          })
          .run();
      });
    });

    await Promise.all(splitPromises);

    // Optionally remove the complete file after splitting
    fs.unlinkSync(tempAudioPath);

    return { chunksDir, videoId };
  } catch (error) {
    console.error("Error in downloadVideoInChunks:", error);
    throw error;
  }
}

// Function to scrape YouTube video links from a channel
export async function scrapeYoutubeVideos() {
  try {
    const response = await axios.get(CHANNEL_URL);
    const html = response.data;
    const $ = cheerio.load(html);
    const videoUrls: string[] = [];
    
    // Select video elements
    $('a#video-title').each((_, element) => {
      const videoUrl = $(element).attr('href');
      console.log("videoUrl--------->", videoUrl);
      const publishedDateText = $(element).parents('div').find('#metadata-line span').first().text();
      const publishedDate = parsePublishedDate(publishedDateText);

      if (videoUrl && publishedDate && publishedDate >= TWO_YEARS_AGO) {
        videoUrls.push(`https://www.youtube.com${videoUrl}`);
      }
    });

    console.log(videoUrls);
    return videoUrls;
  } catch (error) {
    console.error('Error fetching video links:', error);
    throw error;
  }
}

// Helper function to parse the published date from string
function parsePublishedDate(dateString: string): Date | null {
  const dateMatch = dateString.match(/(\d+)\s+(day|week|month|year)s? ago/);
  if (dateMatch) {
    const amount = parseInt(dateMatch[1]);
    const unit = dateMatch[2];
    const date = new Date();

    switch (unit) {
      case 'day':
        date.setDate(date.getDate() - amount);
        break;
      case 'week':
        date.setDate(date.getDate() - amount * 7);
        break;
      case 'month':
        date.setMonth(date.getMonth() - amount);
        break;
      case 'year':
        date.setFullYear(date.getFullYear() - amount);
        break;
    }
    return date;
  }

  // Handle cases like specific dates (e.g., month/day/year formats)
  const specificDate = new Date(dateString);
  if (!isNaN(specificDate.getTime())) {
    return specificDate;
  }

  return null;
}

