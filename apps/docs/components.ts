import { defineComponents } from "blume";

import Footer from "./components/blume/Footer.astro";
import Pagination from "./components/blume/Pagination.astro";

export default defineComponents({
  layout: {
    Footer,
    // Theme radius (rounded-blume) instead of built-in pill corners.
    Pagination,
  },
});
