import React, { useState } from 'react';

const ReviewCard = ({ review, index }) => {
  const renderRating = (rating) => {
    return (
      <div className="flex items-center gap-1">
        {[...Array(5)].map((_, i) => (
          <span
            key={i}
            className={`text-xl ${
              i < rating ? 'text-yellow-400' : 'text-gray-200'
            }`}
          >
            ★
          </span>
        ))}
      </div>
    );
  };

  return (
    <div
      className="group bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden"
      style={{
        animationDelay: `${index * 100}ms`,
        animation: 'slideIn 0.5s ease-out forwards',
      }}
    >
      <div className="p-6 space-y-4">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
              <span className="text-white text-lg">
                {review.reviewer[0].toUpperCase()}
              </span>
            </div>
            <div>
              <h3 className="font-semibold text-lg text-gray-900">
                {review.reviewer}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                {renderRating(review.rating)}
                <span className="text-sm font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                  {review.rating}/5
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <span className="text-gray-400">🕒</span>
            {review.date}
          </div>
        </div>

        <p className="text-gray-700 leading-relaxed">{review.body}</p>
      </div>
    </div>
  );
};

const ReviewForm = ({ onSubmit, loading }) => {
  const [url, setUrl] = useState('');
  const [numReviews, setNumReviews] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ url, numReviews: Number(numReviews) });
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-3xl mx-auto">
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="flex-1">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter product URL"
              required
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:ring focus:ring-indigo-200 transition-all duration-200"
            />
          </div>

          <div className="w-full md:w-48">
            <input
              type="number"
              value={numReviews}
              onChange={(e) => setNumReviews(e.target.value)}
              min="1"
              placeholder="# of reviews"
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:ring focus:ring-indigo-200 transition-all duration-200"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`flex-shrink-0 font-medium py-3 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${
              loading
                ? 'bg-violet-400 text-white'
                : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white'
            }`}
          >
            {loading ? (
              <>
                <span className="text-lg animate-spin">⌛</span>
                <span>Fetching...</span>
              </>
            ) : (
              <>
                <span className="text-xl">🔍</span>
                Get Reviews
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
};

const ReviewList = ({ reviews }) => {
  if (!reviews.length) return null;

  return (
    <div className="space-y-6 max-w-3xl mx-auto mt-12"> {/* Added mt-12 for spacing */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Product Reviews</h2>
          <span className="px-4 py-1 bg-white/20 rounded-full text-white text-sm font-medium">
            {reviews.length} reviews found
          </span>
        </div>
      </div>
      <div className="space-y-6">
        {reviews.map((review, index) => (
          <ReviewCard key={index} review={review} index={index} />
        ))}
      </div>
    </div>
  );
};

const ReviewScraper = () => {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async ({ url, numReviews }) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `http://localhost:8000/api/reviews?url=${encodeURIComponent(url)}&numReviews=${numReviews}`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch reviews');
      }

      setReviews(data.reviews);
    } catch (err) {
      setError(err.message);
      setReviews([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 py-12 px-4">
      <style>
        {`
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}
      </style>

      <div className="max-w-5xl mx-auto">
        {/* Top Half with Blue Background */}
        <div className="bg-gradient-to-br from-cyan-400 to-blue-600 rounded-t-2xl p-8">
          <div className="text-center space-y-4">
            <h1 className="text-6xl font-extrabold bg-gradient-to-r from-white to-purple-200 bg-clip-text text-transparent">
              Reviews Extractor
            </h1>
            <p className="text-xl text-gray-100">Extract and analyze reviews with ease</p>
          </div>
        </div>

        {/* Bottom Half with White Background */}
        <div className="bg-white rounded-b-2xl shadow-lg p-8 -mt-2">
          <ReviewForm onSubmit={handleSubmit} loading={loading} />
        </div>

        {/* Error Message */}
        {error && (
          <div className="max-w-3xl mx-auto bg-red-50 border-l-4 border-red-500 p-4 rounded-xl mt-4">
            <p className="text-red-700 font-medium">{error}</p>
          </div>
        )}

        {/* Review List */}
        <ReviewList reviews={reviews} />
      </div>
    </div>
  );
};

export default ReviewScraper;
