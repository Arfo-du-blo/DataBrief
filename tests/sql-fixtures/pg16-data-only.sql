--
-- PostgreSQL database dump
--

\restrict Xmt6aXpEnMxJXcI7gQB0c2L674jqafWAeYvVnQq4bD4vLJcTx6RoanTrHCj3egl

-- Dumped from database version 16.11 (Debian 16.11-1.pgdg13+1)
-- Dumped by pg_dump version 16.11 (Debian 16.11-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customers (id, email, name, country, created_at, notes) FROM stdin;
1	ana.secret@example.com	Ana García	ES	2024-01-15 09:30:00+00	CONFIDENTIAL_NOTE_123
2	bob@example.com	Bob O'Brien	IE	2024-02-01 18:45:10+00	Line one\nline two; with semicolon -- not a comment
3	zoe@example.com	Zoë 😀	FR	2024-03-10 00:00:00+00	\N
4	dan@example.com	Dan "The Man" Smith	US	2024-03-11 12:00:00+00	back\\slash path C:\\temp
5	eve@example.com	Eve	DE	2024-04-01 08:00:00+00	
6	confidential_segment_x@example.com	CONFIDENTIAL_CUSTOMER_74291	GB	2024-04-02 08:00:00+00	CONFIDENTIAL_SEGMENT_X
\.


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.orders (id, customer_id, ordered_at, status, total) FROM stdin;
1	1	2024-05-01 10:00:00	paid	25.00
2	1	2024-05-03 11:30:00	shipped	8.00
3	2	2024-05-04 09:15:00	paid	99.99
4	3	2024-05-05 16:20:00	cancelled	0.00
5	6	2024-05-06 13:00:00	paid	12.50
\.


--
-- Data for Name: products; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.products (id, sku, title, price, attrs, labels) FROM stdin;
1	SKU-001	Café	12.50	{"origin": "Colombia", "organic": true}	{organic,coffee}
2	SKU-002	Thé	8.00	\N	{}
3	SKU-003	Chocolat	\N	{"note": "it's a \\"quote\\""}	\N
4	SKU-004	"Quoted" title	99.99	[]	{gift,"two words"}
\.


--
-- Data for Name: order_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.order_items (order_id, line_no, product_id, quantity) FROM stdin;
1	1	1	2
1	2	2	1
2	1	2	1
3	1	4	1
5	1	1	1
\.


--
-- Data for Name: tags; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.tags (id, label) FROM stdin;
1	organic
2	fair-trade
3	gift
\.


--
-- Data for Name: product_tags; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.product_tags (product_id, tag_id) FROM stdin;
1	1
1	2
2	1
4	3
\.


--
-- Data for Name: shipments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.shipments (id, order_id, line_no, carrier, shipped_at) FROM stdin;
1	1	1	DHL	2024-05-02
2	2	1	\N	2024-05-04
3	3	1	UPS	\N
\.


--
-- Data for Name: weird name; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."weird name" (id, "select", "from") FROM stdin;
1	a;b	--x
2	\N	/* not a comment */
\.


--
-- Name: shipments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.shipments_id_seq', 3, true);


--
-- PostgreSQL database dump complete
--

\unrestrict Xmt6aXpEnMxJXcI7gQB0c2L674jqafWAeYvVnQq4bD4vLJcTx6RoanTrHCj3egl

