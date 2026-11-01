--
-- PostgreSQL database dump
--

\restrict mPMwJqrTwKjKfBxEunpUjJxr8MXIIcQx3VA06UYNZHGOKFjkUH2bH1gZEZQoxed

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: order_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.order_status AS ENUM (
    'paid',
    'shipped',
    'cancelled'
);


ALTER TYPE public.order_status OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: customers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    country character(2),
    created_at timestamp with time zone NOT NULL,
    notes text
);


ALTER TABLE public.customers OWNER TO postgres;

--
-- Name: TABLE customers; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.customers IS 'People who bought something; one row per person';


--
-- Name: COLUMN customers.notes; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.customers.notes IS 'Free text written by the sales team';


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_items (
    order_id integer NOT NULL,
    line_no integer NOT NULL,
    product_id integer NOT NULL,
    quantity integer NOT NULL,
    CONSTRAINT order_items_quantity_check CHECK ((quantity >= 0))
);


ALTER TABLE public.order_items OWNER TO postgres;

--
-- Name: orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.orders (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    ordered_at timestamp without time zone NOT NULL,
    status public.order_status DEFAULT 'paid'::public.order_status NOT NULL,
    total numeric(10,2) NOT NULL
);


ALTER TABLE public.orders OWNER TO postgres;

--
-- Name: product_tags; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product_tags (
    product_id integer NOT NULL,
    tag_id integer NOT NULL
);


ALTER TABLE public.product_tags OWNER TO postgres;

--
-- Name: products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.products (
    id integer NOT NULL,
    sku character varying(20) NOT NULL,
    title text NOT NULL,
    price numeric(10,2),
    attrs jsonb,
    labels text[]
);


ALTER TABLE public.products OWNER TO postgres;

--
-- Name: shipments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.shipments (
    id integer NOT NULL,
    order_id integer NOT NULL,
    line_no integer NOT NULL,
    carrier text,
    shipped_at date
);


ALTER TABLE public.shipments OWNER TO postgres;

--
-- Name: shipments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.shipments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.shipments_id_seq OWNER TO postgres;

--
-- Name: shipments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.shipments_id_seq OWNED BY public.shipments.id;


--
-- Name: tags; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tags (
    id integer NOT NULL,
    label text NOT NULL
);


ALTER TABLE public.tags OWNER TO postgres;

--
-- Name: v_order_totals; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_order_totals AS
 SELECT customer_id,
    count(*) AS n,
    sum(total) AS total
   FROM public.orders
  GROUP BY customer_id;


ALTER VIEW public.v_order_totals OWNER TO postgres;

--
-- Name: weird name; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."weird name" (
    id integer NOT NULL,
    "select" text,
    "from" text
);


ALTER TABLE public."weird name" OWNER TO postgres;

--
-- Name: shipments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shipments ALTER COLUMN id SET DEFAULT nextval('public.shipments_id_seq'::regclass);


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
-- Data for Name: product_tags; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.product_tags (product_id, tag_id) FROM stdin;
1	1
1	2
2	1
4	3
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
-- Data for Name: shipments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.shipments (id, order_id, line_no, carrier, shipped_at) FROM stdin;
1	1	1	DHL	2024-05-02
2	2	1	\N	2024-05-04
3	3	1	UPS	\N
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
-- Name: customers customers_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_email_key UNIQUE (email);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (order_id, line_no);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: product_tags product_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_tags
    ADD CONSTRAINT product_tags_pkey PRIMARY KEY (product_id, tag_id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_sku_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_key UNIQUE (sku);


--
-- Name: shipments shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_pkey PRIMARY KEY (id);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: weird name weird name_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."weird name"
    ADD CONSTRAINT "weird name_pkey" PRIMARY KEY (id);


--
-- Name: orders_customer_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX orders_customer_idx ON public.orders USING btree (customer_id);


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: product_tags product_tags_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_tags
    ADD CONSTRAINT product_tags_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_tags product_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_tags
    ADD CONSTRAINT product_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id);


--
-- Name: shipments shipments_order_id_line_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_order_id_line_no_fkey FOREIGN KEY (order_id, line_no) REFERENCES public.order_items(order_id, line_no);


--
-- PostgreSQL database dump complete
--

\unrestrict mPMwJqrTwKjKfBxEunpUjJxr8MXIIcQx3VA06UYNZHGOKFjkUH2bH1gZEZQoxed

