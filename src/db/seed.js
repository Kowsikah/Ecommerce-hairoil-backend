import { pool } from './pool.js';

const product = {
  slug: 'be-in-love-hair-oil',
  name: 'Be in Love Hair Oil',            // TODO: your real product name
  tagline: 'Purely natural. Perfectly you.',
  description:
    'A lightweight blend that restores vibrancy without greasiness. Made with 100% natural, time-honored Ayurvedic ingredients. Suitable for all hair types — men, women and children.',
  benefits: [
    'Improves hair growth & hair texture',
    'Reduces frizz — soft and smooth hair',
    'Helps reduce hair fall',
    'Helps reduce premature greying',
    'Boosts shine and strengthens strands',
    'Deeply hydrates, repairs split ends, soothes the scalp',
  ],
  ingredients: ['Coconut oil', 'Hibiscus', 'Bhringaraj', 'Amla', "Tanner's cassia", 'Curry leaves'],
  how_to_use: [
    'Take a small amount of Be in Love hair oil',
    'Massage into the scalp and hair',
    'Leave for 30 minutes or overnight',
    'Wash with a mild shampoo',
    'Apply to the ends of the hair regularly to reduce split ends',
  ],
  price: 399,     // TODO: your real price
  size_ml: 100,   // TODO: your real size
  stock: 100,
};

try {
  await pool.query(
    `INSERT INTO products (slug,name,tagline,description,benefits,ingredients,how_to_use,price,size_ml,stock)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (slug) DO UPDATE SET
       name=EXCLUDED.name, tagline=EXCLUDED.tagline, description=EXCLUDED.description,
       benefits=EXCLUDED.benefits, ingredients=EXCLUDED.ingredients, how_to_use=EXCLUDED.how_to_use,
       price=EXCLUDED.price, size_ml=EXCLUDED.size_ml, stock=EXCLUDED.stock`,
    [product.slug, product.name, product.tagline, product.description, product.benefits,
     product.ingredients, product.how_to_use, product.price, product.size_ml, product.stock]
  );
  console.log('✅ Product seeded');
} finally {
  await pool.end();
}