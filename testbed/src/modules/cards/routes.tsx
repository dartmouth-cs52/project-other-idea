import type { RouteObject } from "react-router";
import { CardDetailPage } from "./CardDetailPage";
import { CardsPage } from "./CardsPage";
import { NewCardPage, RequestCardPage } from "./NewCardPage";

export const routes: RouteObject[] = [
  { path: "cards", element: <CardsPage /> },
  { path: "cards/new", element: <NewCardPage /> },
  { path: "cards/request", element: <RequestCardPage /> },
  { path: "cards/:id", element: <CardDetailPage /> },
];
