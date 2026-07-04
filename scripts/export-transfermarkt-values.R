#!/usr/bin/env Rscript

# Export Transfermarkt market values using worldfootballR.
#
# Example:
#   Rscript scripts/export-transfermarkt-values.R England 2025 calibration/transfermarkt-values.csv
#
# This intentionally lives outside the JS scraping/import pipeline. The JS model only
# consumes the resulting CSV, so Transfermarkt extraction remains optional and manual.

args <- commandArgs(trailingOnly = TRUE)
country <- ifelse(length(args) >= 1, args[[1]], "England")
start_year <- ifelse(length(args) >= 2, as.integer(args[[2]]), 2025L)
output <- ifelse(length(args) >= 3, args[[3]], "calibration/transfermarkt-values.csv")
mode <- ifelse(length(args) >= 4, args[[4]], "league")

if (!requireNamespace("worldfootballR", quietly = TRUE)) {
  stop("worldfootballR is required. Install with install.packages('worldfootballR')")
}

if (!requireNamespace("readr", quietly = TRUE)) {
  stop("readr is required. Install with install.packages('readr')")
}

message("Exporting Transfermarkt values: country=", country, " start_year=", start_year, " mode=", mode)

if (mode == "team") {
  team_urls <- worldfootballR::tm_league_team_urls(country_name = country, start_year = start_year)
  values <- worldfootballR::tm_each_team_player_market_val(team_urls)
} else {
  values <- worldfootballR::tm_player_market_values(country_name = country, start_year = start_year)
}

values$scraped_at <- as.character(Sys.time())
readr::write_csv(values, output)
message("Wrote ", nrow(values), " rows to ", output)
