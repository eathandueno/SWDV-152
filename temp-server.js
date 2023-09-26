// Imports
import express from 'express';
import path from 'path';
import OpenAI from "openai";
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import axios from 'axios';
import cheerio from 'cheerio';
import { google } from 'googleapis';
import fetch from 'node-fetch';

// API Keys Configuration
dotenv.config();

// Variables
// const fetch = require('node-fetch');
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const openai = new OpenAI({apiKey:process.env.OPEN_AI});
const customsearch = google.customsearch('v1');

app.use(express.static(path.join(__dirname, '.')));
app.use(express.json());

// App Get Routes 
app.get('/find-leads', async (req, res) => {
  const state = req.query.state;
  const city = req.query.city;
  const sector = req.query.sector;

  const apiUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${sector}+in+${city},+${state}&key=${process.env.GOOGLE_API}`;

  try {
      const response = await fetch(apiUrl);
      const data = await response.json();

      console.log('Received data:', data);

      // Make sure results exist in data
      if (!data.results) {
          console.log('Results not found in data:', data);
          return res.status(400).json({ error: 'No results found' });
      }

      // Calculate the lead score for each business
      const leads = data.results.map(result => {
          return {
              name: result.name,
              rating: result.rating || 'N/A',
              leadScore: calculateLeadScore(result)
          };
      });

      res.json({ leads: leads });
  } catch (error) {
      console.log('Error:', error);
      res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

function calculateLeadScore(lead) {
  // Implement your lead score calculation logic here
  let score = 0;
  // Example: if the URL is shorter, we assume it's a more established business
  if (lead.url) {
    score = 100 - lead.url.length;
  }
  return score;
}

// App Post Routes
app.post('/ask', async (req, res) => {
    try {
        const userMessage = req.body.message;
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: "You are a medical professional that references WebMD for accurate information to help aid clients with medical concerns. Make sure to follow professional communication standards, never break character and do not discuss personal information that is not medical related." },
                { role: "user", content: userMessage },
            ],
            model: "gpt-3.5-turbo-0613",
        });

        const botResponse = completion.choices[0].message.content;
        res.json({ message: botResponse });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

app.post('/generate-seo-tags', async (req, res) => {
    try {
        const { currentTitle, currentDescription } = req.body;
        
        const messages = [
            { role: "system", content: "You are tasked with generating SEO tags. Provide only a improved title and description for SEO." },
            { role: "user", content: `Current title: ${currentTitle}. Current description: ${currentDescription}. Please generate improved versions.` }
        ];

        const completion = await openai.chat.completions.create({
            messages,
            model: "gpt-3.5-turbo-0613",
        });

        const botResponse = completion.choices[0].message.content;
        // Use regex to strip unwanted prefaces
        const titleMatch = botResponse.match(/Improved title: (.+)/i);
        const descriptionMatch = botResponse.match(/Improved description: (.+)/i);
        
        const newTitle = titleMatch ? titleMatch[1] : "";
        const newDescription = descriptionMatch ? descriptionMatch[1] : "";

        res.json({ newTitle, newDescription });

        // res.json({ newTitle, newDescription });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

async function scrapeTitleAndH1(url) {
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    const title = $("head title").text();
    const metaDescription = $('meta[name="description"]').attr("content");
    const h1Tags = [];
    const imgAlts = [];
    let imgCount = 0;

    $("h1").each((index, element) => {
      h1Tags.push($(element).text());
    });

    $("img").each((index, element) => {
      imgCount++;
      imgAlts.push($(element).attr("alt"));
    });

    return { title, h1Tags, imgCount, imgAlts, metaDescription };
  } catch (error) {
    console.error(`Error scraping ${url}: ${error}`);
    return null;
  }
}
async function scrapeSchemaMarkup(url) {
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    const schemaScripts = [];

    $('script[type="application/ld+json"]').each((index, element) => {
      try {
        const parsedSchema = JSON.parse($(element).html());
        schemaScripts.push(parsedSchema);
      } catch (error) {
        console.error(`Error parsing JSON-LD schema: ${error}`);
      }
    });

    return { schemaScripts };
  } catch (error) {
    console.error(`Error scraping ${url}: ${error}`);
    return null;
  }
}

app.post("/scrape-schema", async (req, res) => {
  try {
    const { url } = req.body;
    const scrapedSchema = await scrapeSchemaMarkup(url);

    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: "You are tasked with creating an SEO optimized schema markup." },
        { role: "user", content: `Scraped Schema: ${JSON.stringify(scrapedSchema.schemaScripts)}.` }
      ],
      model: "gpt-3.5-turbo-0613",
    });

    const summary = completion.choices[0].message.content;

    res.json({ ...scrapedSchema, summary });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.post("/scrape-and-summarize", async (req, res) => {
  try {
    const { url } = req.body;
    const scrapedData = await scrapeTitleAndH1(url);

    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: "You are tasked with creating an FAQ  schema markup. Return in JSON format please." },
        { role: "user", content: `Title: ${scrapedData.title}. H1 Tags: ${scrapedData.h1Tags.join(", ")}.Alt Tags: ${scrapedData.imgAlts.join(", ")}. Meta Description: ${scrapedData.metaDescription}. Please summarize.` }
      ],
      model: "gpt-3.5-turbo-0613",
    });

    const summary = completion.choices[0].message.content;

    res.json({ ...scrapedData, summary });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

  app.post('/search-competitors', async (req, res) => {
    try {
      const { company } = req.body;
      
      // Use GPT-4 to determine the sector of the given company
      const sectorResponse = await openai.chat.completions.create({
        messages: [
          { role: "system", content: "You are tasked with determining the sector of a company, give no dialogue but the sector." },
          { role: "user", content: `What sector does the company ${company} belong to?` },
        ],
        model: "gpt-3.5-turbo-0613",
      });
  
      const sector = sectorResponse.choices[0].message.content.trim();
      
      // Use Google Custom Search to find competitors in that sector
      const response = await customsearch.cse.list({
        cx: process.env.SEARCH_ENGINE_ID,  // Replace with your search engine ID
        q: `${company} in ${sector} competitors`,
        auth: process.env.GOOGLE_API,
        num: 2  // Number of results to return
      });
  
      const competitors = response.data.items.map(item => ({ title: item.title, link: item.link }));
  
      res.json({ competitors });
  
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});