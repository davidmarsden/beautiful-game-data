#!/usr/bin/env Rscript

# Export Transfermarkt market values using worldfootballR.
#
# Example:
#   Rscript scripts/export-transfermarkt-values.R England 2024 calibration/transfermarkt-values.csv
#
# This intentionally lives outside the JS scraping/import pipeline. The JS model only
# consumes the resulting CSV, so Transfermarkt extraction remains optional and manual.

args <- commandArgs(trailingOnly = TRUE)
country <- ifelse(length(args) >= 1, args[[1]], "England")
start_year <- ifelse(length(args) >= 2, as.integer(args[[2]]), 2024L)
output <- ifelse(length(args) >= 3, args[[3]], "calibration/transfermarkt-values.csv")
mode <- ifelse(length(args) >= 4, args[[4]], "league")
fallback_year <- ifelse(length(args) >= 5, as.integer(args[[5]]), 2024L)

if (!requireNamespace("worldfootballR", quietly = TRUE)) {
  stop("worldfootballR is required. Install with install.packages('worldfootballR')")
}

if (!requireNamespace("readr", quietly = TRUE)) {
  stop("readr is required. Install with install.packages('readr')")
}

fetch_values <- function(year) {
  message("Exporting Transfermarkt values: country=", country, " start_year=", year, " mode=", mode)
  if (mode == "team") {
    team_urls <- worldfootballR::tm_league_team_urls(country_name = country, start_year = year)
    return(worldfootballR::tm_each_team_player_market_val(team_urls))
  }
  worldfootballR::tm_player_market_values(country_name = country, start_year = year)
}

values <- tryCatch(
  fetch_values(start_year),
  error = function(err) {
    if (!is.na(fallback_year) && fallback_year != start_year) {
      message("Transfermarkt season ", start_year, " failed: ", conditionMessage(err))
      message("Falling back to latest configured Transfermarkt season: ", fallback_year)
      return(fetch_values(fallback_year))
    }
    stop(err)
  }
)

values$requested_start_year <- start_year
values$transfermarkt_start_year <- ifelse(!is.na(fallback_year) && fallback_year != start_year, fallback_year, start_year)
values$scraped_at <- as.character(Sys.time())
readr::write_csv(values, output)
message("Wrote ", nrow(values), " rows to ", output)
