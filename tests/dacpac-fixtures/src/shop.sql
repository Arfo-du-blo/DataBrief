-- The "shop" schema in T-SQL, built into a .dacpac by Microsoft's own DacFx library (tests/make_dacpac_fixtures.sh).
-- Statements are separated by a line holding three dashes.
CREATE SCHEMA [audit];
---
CREATE TABLE [dbo].[Customers] (
  [Id] INT IDENTITY(1,1) NOT NULL,
  [Email] NVARCHAR(255) NOT NULL,
  [Name] NVARCHAR(100) NOT NULL,
  [Country] CHAR(2) NULL,
  [CreatedAt] DATETIME2(0) NOT NULL,
  [Notes] NVARCHAR(MAX) NULL,
  [Balance] DECIMAL(10,2) NULL,
  [Active] BIT NOT NULL CONSTRAINT [DF_Customers_Active] DEFAULT ((1)),
  [Label] AS ([Name] + N' (' + [Country] + N')'),
  CONSTRAINT [PK_Customers] PRIMARY KEY CLUSTERED ([Id] ASC),
  CONSTRAINT [UQ_Customers_Email] UNIQUE NONCLUSTERED ([Email])
);
---
CREATE TABLE [dbo].[Products] (
  [Id] INT NOT NULL,
  [Sku] VARCHAR(20) NOT NULL,
  [Unit Price] MONEY NULL,
  [Stock] SMALLINT NULL,
  CONSTRAINT [PK_Products] PRIMARY KEY ([Id])
);
---
CREATE TABLE [dbo].[Tags] ([Id] INT NOT NULL PRIMARY KEY, [Label] NVARCHAR(50) NOT NULL);
---
CREATE TABLE [dbo].[ProductTags] (
  [ProductId] INT NOT NULL,
  [TagId] INT NOT NULL,
  CONSTRAINT [PK_ProductTags] PRIMARY KEY ([ProductId], [TagId]),
  CONSTRAINT [FK_ProductTags_Products] FOREIGN KEY ([ProductId]) REFERENCES [dbo].[Products] ([Id]) ON DELETE CASCADE,
  CONSTRAINT [FK_ProductTags_Tags] FOREIGN KEY ([TagId]) REFERENCES [dbo].[Tags] ([Id])
);
---
CREATE TABLE [dbo].[Orders] (
  [Id] INT NOT NULL,
  [CustomerId] INT NOT NULL,
  [OrderedAt] DATETIME2(0) NOT NULL,
  [Status] VARCHAR(20) NOT NULL,
  [Total] DECIMAL(10,2) NOT NULL,
  CONSTRAINT [PK_Orders] PRIMARY KEY ([Id]),
  CONSTRAINT [FK_Orders_Customers] FOREIGN KEY ([CustomerId]) REFERENCES [dbo].[Customers] ([Id]) ON DELETE CASCADE ON UPDATE NO ACTION
);
---
CREATE TABLE [dbo].[OrderItems] (
  [OrderId] INT NOT NULL,
  [LineNo] INT NOT NULL,
  [ProductId] INT NOT NULL,
  [Quantity] INT NOT NULL,
  CONSTRAINT [PK_OrderItems] PRIMARY KEY ([OrderId], [LineNo]),
  CONSTRAINT [FK_OrderItems_Orders] FOREIGN KEY ([OrderId]) REFERENCES [dbo].[Orders] ([Id]),
  CONSTRAINT [FK_OrderItems_Products] FOREIGN KEY ([ProductId]) REFERENCES [dbo].[Products] ([Id]),
  CONSTRAINT [CK_OrderItems_Quantity] CHECK ([Quantity] >= 0)
);
---
CREATE TABLE [dbo].[Shipments] (
  [Id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  [OrderId] INT NOT NULL,
  [LineNo] INT NOT NULL,
  [Carrier] NVARCHAR(50) NULL,
  CONSTRAINT [FK_Shipments_OrderItems] FOREIGN KEY ([OrderId], [LineNo]) REFERENCES [dbo].[OrderItems] ([OrderId], [LineNo])
);
---
CREATE TABLE [audit].[Log] ([Id] INT NOT NULL PRIMARY KEY, [Msg] NVARCHAR(200) NULL);
---
CREATE INDEX [IX_Orders_Customer] ON [dbo].[Orders] ([CustomerId]);
---
CREATE VIEW [dbo].[v_order_totals] AS SELECT [CustomerId], COUNT(*) AS [n], SUM([Total]) AS [total] FROM [dbo].[Orders] GROUP BY [CustomerId];
---
CREATE PROCEDURE [dbo].[p_touch] AS BEGIN SET NOCOUNT ON; SELECT 1; END;
---
EXEC sp_addextendedproperty @name = N'MS_Description', @value = N'People who bought something; one row per person', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'Customers';
---
EXEC sp_addextendedproperty @name = N'MS_Description', @value = N'Free text written by the sales team', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'Customers', @level2type = N'COLUMN', @level2name = N'Notes';
