# Homepage photo gallery

The homepage gallery intentionally contains labeled placeholders, not sample or generated personal photos.

To add a photo:

1. Copy your image into this folder.
2. In `src/pages/index.astro`, find the `photoSlots` list.
3. Set that slot's `src` to `/images/about/your-file.jpg` and `alt` to a concise description of the image.

The `filename` value shown in each placeholder is a suggested filename. You can replace it or add more slots to `photoSlots`. Images are lazy-loaded below the fold.

The photo strip loops continuously at a steady speed. Use its **Pause photos** control to stop it; visitors who prefer reduced motion get a stationary, horizontally scrollable strip.
