//! Schema loading and parsing for n8n node types

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeSchema {
    pub name: String,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub version: SchemaVersion,
    #[serde(rename = "defaultVersion")]
    pub default_version: Option<i32>,
    pub properties: Vec<PropertySchema>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SchemaVersion {
    Single(i32),
    Multiple(Vec<i32>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertySchema {
    pub name: String,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(rename = "type")]
    pub prop_type: String,
    pub required: Option<bool>,
    pub default: Option<serde_json::Value>,
    pub description: Option<String>,
    pub options: Option<Vec<PropertyOption>>,
    #[serde(rename = "displayOptions")]
    pub display_options: Option<DisplayOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyOption {
    pub name: String,
    pub value: serde_json::Value,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayOptions {
    pub show: Option<HashMap<String, Vec<serde_json::Value>>>,
    pub hide: Option<HashMap<String, Vec<serde_json::Value>>>,
}

pub struct SchemaLoader {
    schemas: HashMap<String, NodeSchema>,
}

impl SchemaLoader {
    pub fn new() -> Self {
        Self {
            schemas: HashMap::new(),
        }
    }
    
    pub fn load_from_file<P: AsRef<Path>>(&mut self, path: P) -> Result<(), String> {
        let content = fs::read_to_string(path)
            .map_err(|e| format!("Failed to read schema file: {}", e))?;
        
        let schemas: Vec<NodeSchema> = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse schema: {}", e))?;
        
        for schema in schemas {
            self.schemas.insert(schema.name.clone(), schema);
        }
        
        Ok(())
    }
    
    pub fn get(&self, node_type: &str) -> Option<&NodeSchema> {
        self.schemas.get(node_type)
    }
    
    pub fn get_property_options(&self, node_type: &str, property: &str) -> Option<Vec<String>> {
        self.get(node_type)
            .and_then(|schema| {
                schema.properties.iter()
                    .find(|p| p.name == property)
                    .and_then(|p| p.options.as_ref())
                    .map(|opts| opts.iter().map(|o| format!("{:?}", o.value)).collect())
            })
    }
}

impl Default for SchemaLoader {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_schema_loader_new() {
        let loader = SchemaLoader::new();
        assert!(loader.schemas.is_empty());
    }
}
