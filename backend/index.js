import express from 'express';
import cors from 'cors';
import playwright from 'playwright';
import fetch from 'node-fetch';

const app = express();
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-frontend-domain.vercel.app', 'https://review-scraper-frontend.vercel.app']
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'POST'],
  credentials: true
}));

// Helper function to chunk HTML
function chunkHtml(html, chunkSize = 20000) {
  const chunks = [];
  for (let i = 0; i < html.length; i += chunkSize) {
    chunks.push(html.slice(i, i + chunkSize));
  }
  return chunks;
}

// Helper function to filter chunks containing reviews
function filterChunksWithReviews(chunks) {
  return chunks.filter((chunk) => chunk.toLowerCase().includes('rating'));
}

// Helper function to log review details
function logReviewDetails(reviews) {
  console.log('\n=== Review Details ===\n');
  reviews.forEach((review, index) => {
    console.log(`Review #${index + 1}`);
    console.log('Reviewer:', review.reviewer);
    console.log('Rating:', '⭐'.repeat(Math.min(review.rating, 5)));
    
    console.log('Date:', review.date);
    console.log('Review:', review.body);
    console.log('-------------------\n');
  });
  console.log(`Total Reviews: ${reviews.length}\n`);
}

// Add Ollama helper function
async function generateWithOllama(prompt, content) {
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mistral',
        prompt: `${prompt}\n\n${content}`,
        stream: false,
      }),
    });

    const data = await response.json();
    return data.response;
  } catch (error) {
    console.error('Ollama API error:', error);
    throw error;
  }
}

// Process HTML chunks to extract selectors
async function extractSelectors(reviewChunks, page) {
  let selectors = {};
  let selectorsFound = false;

  // Known review system selectors
  const knownSelectors = {
    'judge.me': {
      container: '.jdgm-rev',
      name: '.jdgm-rev__author',
      rating: '.jdgm-rev__rating',
      review: '.jdgm-rev__body',
      date: '.jdgm-rev__timestamp',
      nextPageSelector: '.jdgm-paginate__next-page'
    }
  };

  // First try to detect known review systems
  for (const [system, systemSelectors] of Object.entries(knownSelectors)) {
    try {
      const testElement = await page.$(systemSelectors.container);
      if (testElement) {
        console.log(`✓ Detected ${system} review system`);
        return systemSelectors;
      }
    } catch (error) {
      console.log(`× Not using ${system} review system`);
    }
  }

  // If no known system found, try extracting from chunks
  for (let i = 0; i < reviewChunks.length; i++) {
    if (selectorsFound) break;

    console.log(`\nAnalyzing chunk ${i + 1} of ${reviewChunks.length}`);
    
    const prompt = `You are a CSS selector extractor. Your task is to analyze HTML and return ONLY a JSON object containing selectors for review elements. If no review elements are found, return {"found": false}. If found, return selectors in this format:
    {
      "found": true,
      "selectors": {
        "container": "selector for the review container element",
        "name": "selector for reviewer name element",
        "rating": "selector for rating element",
        "review": "selector for review text element",
        "date": "selector for review date element",
        "nextPageSelector": "selector for next page button"
      }
    }
    
    HTML to analyze:`;

    try {
      const response = await generateWithOllama(prompt, reviewChunks[i]);

      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log('× No JSON found in response, skipping chunk');
        continue;
      }

      try {
        const parsedResponse = JSON.parse(jsonMatch[0]);

        // Check if reviews were found
        if (!parsedResponse.found) {
          console.log('× No review elements found in this chunk');
          continue;
        }

        // Validate the selectors
        const extractedSelectors = parsedResponse.selectors;
        const requiredFields = ['container', 'name', 'rating', 'review', 'date', 'nextPageSelector'];
        
        const hasAllFields = requiredFields.every(field => 
          extractedSelectors[field] && 
          typeof extractedSelectors[field] === 'string' &&
          extractedSelectors[field].trim() !== ''
        );

        if (!hasAllFields) {
          console.log('× Missing required selectors, skipping chunk');
          continue;
        }

        // Verify selectors exist in page
        const containerExists = await page.$(extractedSelectors.container);
        if (!containerExists) {
          console.log('× Selectors not found in page content');
          continue;
        }

        console.log('✓ Found valid selectors:', extractedSelectors);
        selectors = extractedSelectors;
        selectorsFound = true;

      } catch (parseError) {
        console.log(`× Invalid JSON in chunk ${i + 1}:`, parseError.message);
      }
    } catch (error) {
      console.log(`× Error processing chunk ${i + 1}:`, error.message);
    }
  }

  if (!selectorsFound) {
    throw new Error('Could not find valid review selectors in any chunk');
  }

  return selectors;
}

// Add this helper function to validate extracted reviews
function validateReview(review) {
  return {
    isValid: !!(review.reviewer && review.body && review.date),
    issues: [
      !review.reviewer && 'missing reviewer name',
      !review.body && 'missing review text',
      !review.date && 'missing date',
      (review.rating === undefined || review.rating === null) && 'missing rating'
    ].filter(Boolean)
  };
}

app.get('/api/reviews', async (req, res) => {
  const { url, numReviews=5} = req.query;
  console.log(numReviews) // Default to 5 reviews if numReviews is not provided

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    const browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();

    let allReviews = [];
    let selectors = null; // Cache selectors after first extraction

    console.log(`Scraping reviews from ${url}, aiming for ${numReviews} reviews.`);

    await page.goto(url);
    await page.waitForSelector('body');

    // Check if the popup exists and close it
    const closePopupSelector = '.store-selection-popup--close';
    const popupCloseButton = await page.$(closePopupSelector);
    if (popupCloseButton) {
      console.log('Popup found, closing it...');
      await popupCloseButton.click();
      await page.waitForTimeout(1000); // Wait for the popup to close
    } else {
      console.log('No popup found.');
    }

    while (allReviews.length < numReviews) {
      const fullHtml = await page.content();

      // Extract selectors if not already done
      if (!selectors) {
        const htmlChunks = chunkHtml(fullHtml);
        const reviewChunks = filterChunksWithReviews(htmlChunks);
        reviewChunks.reverse(); // Process chunks from the end
        selectors = await extractSelectors(reviewChunks, page);

        if (Object.keys(selectors).length === 0) {
          await browser.close();
          return res.status(404).json({ error: 'Review selectors not found.' });
        }

        console.log('Extracted selectors:', selectors);
      } else {
        console.log('Reusing cached selectors:', selectors);
      }

      // Extract reviews from the current page
      const reviews = await page.evaluate((selectors) => {
        const reviewElements = document.querySelectorAll(selectors.container);
        console.log(`Found ${reviewElements.length} review elements`);
        
        return Array.from(reviewElements).map((review) => {
          try {
            const nameElement = review.querySelector(selectors.name);
            const ratingElement = review.querySelector(selectors.rating);
            const reviewElement = review.querySelector(selectors.review);
            const dateElement = review.querySelector(selectors.date);

            let rating = 0;
            if (ratingElement) {
              // Try multiple rating formats
              const ariaLabel = ratingElement.getAttribute('aria-label');
              const dataRating = ratingElement.getAttribute('data-rating');
              const ratingText = ratingElement.textContent;

              if (ariaLabel?.includes('star')) {
                const match = ariaLabel.match(/(\d+)\s*star/i);
                rating = match ? parseInt(match[1], 10) : 0;
              } else if (dataRating) {
                rating = parseInt(dataRating, 10);
              } else if (ratingText) {
                const match = ratingText.match(/(\d+)/);
                rating = match ? parseInt(match[1], 10) : 0;
              }
            }

            return {
              title: nameElement?.textContent?.trim() || '',
              body: reviewElement?.textContent?.trim() || '',
              rating: Math.min(Math.max(rating, 0), 5),
              reviewer: nameElement?.textContent?.trim() || '',
              date: dateElement?.textContent?.trim() || '',
            };
          } catch (error) {
            console.error('Error extracting review:', error);
            return null;
          }
        }).filter(Boolean); // Remove any failed extractions
      }, selectors);

      allReviews = [...allReviews, ...reviews];

      // Check if we have collected enough reviews
      if (allReviews.length >= numReviews) {
        console.log('Collected required number of reviews.');
        break;
      }

      // Try navigating to the next page
      const nextPageButton = await page.$(selectors.nextPageSelector);
      if (nextPageButton) {
        console.log('Loading next page...');
        await nextPageButton.click();
        await page.waitForTimeout(3000); // Add delay for loading
      } else {
        console.log('No next page found, stopping.');
        break;
      }
    }

    await browser.close();

    const filteredReviews = allReviews.slice(0, numReviews).filter((review) => review.title && review.body);

    logReviewDetails(filteredReviews);

    return res.json({
      reviews_numReviews: filteredReviews.length,
      reviews: filteredReviews,
    });
  } catch (error) {
    console.error('Exception occurred:', error);
    return res.status(500).json({ error: 'An error occurred while processing reviews.' });
  }
});
app.get("/",(req,res)=>{
  res.send("hello Worls !");
})

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});