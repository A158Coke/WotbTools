//! `.wotbreplay` container reader.
//!
//! Authority: `docs/reference/replay-data.md` (file structure + parse budget). The container is a
//! plain ZIP holding exactly three entries; the whitelist, the entry-count contract and the
//! uncompressed budget are enforced before any entry is decompressed, so a hostile archive cannot
//! make the engine allocate unbounded memory.
//!
//! `parseResult` must never read `data.wotreplay`: this type only *lists* it from the central
//! directory (name + declared size) and only decompresses it when [`ReplayArchive::read_stream`] is
//! called explicitly by the stream path.

use std::io::{Cursor, Read};

use zip::ZipArchive;

use crate::error::ReplayError;

pub const META_ENTRY: &str = "meta.json";
pub const RESULTS_ENTRY: &str = "battle_results.dat";
pub const STREAM_ENTRY: &str = "data.wotreplay";

/// Uncompressed caps, mirrored from the production replay contract.
pub const MAX_META_BYTES: u64 = 1024 * 1024;
pub const MAX_RESULTS_BYTES: u64 = 8 * 1024 * 1024;
pub const MAX_STREAM_BYTES: u64 = 20 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: u64 = 24 * 1024 * 1024;

/// Entries the container must (and may only) hold.
pub const ENTRY_COUNT: usize = 3;

/// Borrowed view over validated archive bytes.
#[derive(Debug)]
pub struct ReplayArchive<'a> {
    bytes: &'a [u8],
}

impl<'a> ReplayArchive<'a> {
    /// Validates the container contract without decompressing any entry.
    pub fn open(bytes: &'a [u8]) -> Result<Self, ReplayError> {
        let mut zip = ZipArchive::new(Cursor::new(bytes))
            .map_err(|e| ReplayError::InvalidArchive(e.to_string()))?;
        if zip.len() != ENTRY_COUNT {
            return Err(ReplayError::InvalidArchive(format!(
                "expected {ENTRY_COUNT} entries, found {}",
                zip.len()
            )));
        }

        let mut meta: Option<u64> = None;
        let mut results: Option<u64> = None;
        let mut stream: Option<u64> = None;
        for index in 0..zip.len() {
            let file = zip
                .by_index(index)
                .map_err(|e| ReplayError::InvalidArchive(e.to_string()))?;
            if file.is_dir() {
                return Err(ReplayError::InvalidArchive(format!(
                    "unexpected directory entry {}",
                    file.name()
                )));
            }
            let size = file.size();
            let slot = match file.name() {
                META_ENTRY => &mut meta,
                RESULTS_ENTRY => &mut results,
                STREAM_ENTRY => &mut stream,
                other => {
                    return Err(ReplayError::InvalidArchive(format!(
                        "unexpected entry {other}"
                    )))
                }
            };
            if slot.replace(size).is_some() {
                return Err(ReplayError::InvalidArchive(format!(
                    "duplicate entry {}",
                    file.name()
                )));
            }
        }

        let (Some(meta_bytes), Some(results_bytes), Some(stream_bytes)) = (meta, results, stream)
        else {
            return Err(ReplayError::InvalidArchive(
                "missing one of meta.json / battle_results.dat / data.wotreplay".to_string(),
            ));
        };

        check_cap(META_ENTRY, meta_bytes, MAX_META_BYTES)?;
        check_cap(RESULTS_ENTRY, results_bytes, MAX_RESULTS_BYTES)?;
        check_cap(STREAM_ENTRY, stream_bytes, MAX_STREAM_BYTES)?;

        let total_bytes = meta_bytes + results_bytes + stream_bytes;
        if total_bytes > MAX_TOTAL_BYTES {
            return Err(ReplayError::InvalidArchive(format!(
                "uncompressed total {total_bytes} exceeds {MAX_TOTAL_BYTES}"
            )));
        }

        Ok(Self { bytes })
    }

    /// Raw `meta.json` bytes. Content problems are handled by the metadata layer, not here.
    pub fn read_meta(&self) -> Result<Vec<u8>, ReplayError> {
        self.read_entry(META_ENTRY)
    }

    /// Raw `battle_results.dat` bytes (pickle frame wrapping protobuf).
    pub fn read_results(&self) -> Result<Vec<u8>, ReplayError> {
        self.read_entry(RESULTS_ENTRY)
    }

    /// Raw `data.wotreplay` bytes. Only the stream path may call this.
    pub fn read_stream(&self) -> Result<Vec<u8>, ReplayError> {
        self.read_entry(STREAM_ENTRY).map_err(|e| match e {
            ReplayError::InvalidArchive(message) => ReplayError::CorruptedStream(message),
            other => other,
        })
    }

    fn read_entry(&self, name: &str) -> Result<Vec<u8>, ReplayError> {
        let mut zip = ZipArchive::new(Cursor::new(self.bytes))
            .map_err(|e| ReplayError::InvalidArchive(e.to_string()))?;
        let mut file = zip
            .by_name(name)
            .map_err(|e| ReplayError::InvalidArchive(format!("cannot open entry {name}: {e}")))?;
        let mut out = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut out)
            .map_err(|e| ReplayError::InvalidArchive(format!("cannot read entry {name}: {e}")))?;
        Ok(out)
    }
}

fn check_cap(name: &str, actual: u64, cap: u64) -> Result<(), ReplayError> {
    if actual > cap {
        return Err(ReplayError::InvalidArchive(format!(
            "entry {name} is {actual} bytes, cap is {cap}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_zip_bytes() {
        let err = ReplayArchive::open(b"not a zip").unwrap_err();
        assert_eq!(err.code(), "INVALID_ARCHIVE");
    }
}
