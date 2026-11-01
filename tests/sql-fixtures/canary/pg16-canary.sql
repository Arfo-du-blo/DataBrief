--
-- PostgreSQL database dump
--

\restrict 6YU3lZdNdhrKkRa3GhBcAcX9bdtkzxYtnyrfMLm8Q0U0c4kRC4M72kxHnbv8wDF

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
-- Name: CONFIDENTIAL_COL_ENUM; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."CONFIDENTIAL_COL_ENUM" AS ENUM (
    'CONFIDENTIAL_LABEL_E1',
    'CONFIDENTIAL_LABEL_E2'
);


ALTER TYPE public."CONFIDENTIAL_COL_ENUM" OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: CONFIDENTIAL_COL_PARENT; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."CONFIDENTIAL_COL_PARENT" (
    "CONFIDENTIAL_COL_ID" integer NOT NULL,
    label text
);


ALTER TABLE public."CONFIDENTIAL_COL_PARENT" OWNER TO postgres;

--
-- Name: CONFIDENTIAL_COL_TABLE; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."CONFIDENTIAL_COL_TABLE" (
    "CONFIDENTIAL_COL_A" text DEFAULT 'CONFIDENTIAL_SQL_DEFAULT'::text,
    "CONFIDENTIAL_COL_B" integer,
    "CONFIDENTIAL_COL_C" text,
    "CONFIDENTIAL_COL_PID" integer,
    "CONFIDENTIAL_COL_KIND" public."CONFIDENTIAL_COL_ENUM"
);


ALTER TABLE public."CONFIDENTIAL_COL_TABLE" OWNER TO postgres;

--
-- Name: TABLE "CONFIDENTIAL_COL_TABLE"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public."CONFIDENTIAL_COL_TABLE" IS 'CONFIDENTIAL_TEXT_TABLECOMMENT';


--
-- Name: COLUMN "CONFIDENTIAL_COL_TABLE"."CONFIDENTIAL_COL_A"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public."CONFIDENTIAL_COL_TABLE"."CONFIDENTIAL_COL_A" IS 'CONFIDENTIAL_LABEL_COLCOMMENT';


--
-- Name: CONFIDENTIAL_COL_VIEW; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public."CONFIDENTIAL_COL_VIEW" AS
 SELECT "CONFIDENTIAL_COL_A"
   FROM public."CONFIDENTIAL_COL_TABLE"
  WHERE ("CONFIDENTIAL_COL_A" = 'CONFIDENTIAL_SQL_LITERAL'::text);


ALTER VIEW public."CONFIDENTIAL_COL_VIEW" OWNER TO postgres;

--
-- Data for Name: CONFIDENTIAL_COL_PARENT; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."CONFIDENTIAL_COL_PARENT" ("CONFIDENTIAL_COL_ID", label) FROM stdin;
1	CONFIDENTIAL_REC_PARENT
\.


--
-- Data for Name: CONFIDENTIAL_COL_TABLE; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."CONFIDENTIAL_COL_TABLE" ("CONFIDENTIAL_COL_A", "CONFIDENTIAL_COL_B", "CONFIDENTIAL_COL_C", "CONFIDENTIAL_COL_PID", "CONFIDENTIAL_COL_KIND") FROM stdin;
CONFIDENTIAL_REC_01	100	common	1	CONFIDENTIAL_LABEL_E1
CONFIDENTIAL_REC_02	103	common	1	CONFIDENTIAL_LABEL_E1
CONFIDENTIAL_REC_03	106	common	1	\N
CONFIDENTIAL_REC_04	109	common	1	\N
CONFIDENTIAL_REC_05	112	common	1	\N
CONFIDENTIAL_REC_06	115	common	1	\N
CONFIDENTIAL_REC_07	118	common	1	\N
CONFIDENTIAL_REC_08	121	common	1	\N
CONFIDENTIAL_REC_09	124	other	1	\N
CONFIDENTIAL_REC_10	127	other	1	\N
CONFIDENTIAL_REC_11	130	other	1	\N
CONFIDENTIAL_REC_12	133	CONFIDENTIAL_REC_RARE	1	\N
\.


--
-- Name: CONFIDENTIAL_COL_PARENT CONFIDENTIAL_COL_PARENT_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CONFIDENTIAL_COL_PARENT"
    ADD CONSTRAINT "CONFIDENTIAL_COL_PARENT_pkey" PRIMARY KEY ("CONFIDENTIAL_COL_ID");


--
-- Name: CONFIDENTIAL_COL_INDEX; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "CONFIDENTIAL_COL_INDEX" ON public."CONFIDENTIAL_COL_TABLE" USING btree ("CONFIDENTIAL_COL_B");


--
-- Name: CONFIDENTIAL_COL_TABLE CONFIDENTIAL_COL_TABLE_CONFIDENTIAL_COL_PID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CONFIDENTIAL_COL_TABLE"
    ADD CONSTRAINT "CONFIDENTIAL_COL_TABLE_CONFIDENTIAL_COL_PID_fkey" FOREIGN KEY ("CONFIDENTIAL_COL_PID") REFERENCES public."CONFIDENTIAL_COL_PARENT"("CONFIDENTIAL_COL_ID");


--
-- PostgreSQL database dump complete
--

\unrestrict 6YU3lZdNdhrKkRa3GhBcAcX9bdtkzxYtnyrfMLm8Q0U0c4kRC4M72kxHnbv8wDF

