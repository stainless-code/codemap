import { defineComponents } from "blume";

import Header from "./components/blume/Header.astro";
import Pagination from "./components/blume/Pagination.astro";

export default defineComponents({
  layout: {
    Header,
    // Footer omitted from layout — homepage-only in `pages/index.astro`.
    // Theme radius (rounded-blume) instead of built-in pill corners.
    Pagination,
  },
});
