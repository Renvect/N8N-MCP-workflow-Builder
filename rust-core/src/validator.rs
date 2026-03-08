//! Parameter validation against node schemas

use crate::schema::{NodeSchema, PropertySchema, SchemaLoader};
use std::collections::HashMap;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ValidationError {
    #[error("Unknown node type: {0}")]
    UnknownNodeType(String),
    
    #[error("Unknown property '{property}' on node type '{node_type}'")]
    UnknownProperty { node_type: String, property: String },
    
    #[error("Invalid value '{value}' for property '{property}'. Valid options: {valid_options}")]
    InvalidOptionValue {
        property: String,
        value: String,
        valid_options: String,
    },
    
    #[error("Required property '{property}' is missing")]
    MissingRequired { property: String },
    
    #[error("Type mismatch for property '{property}': expected {expected}, got {actual}")]
    TypeMismatch {
        property: String,
        expected: String,
        actual: String,
    },
}

pub struct ParameterValidator<'a> {
    schema_loader: &'a SchemaLoader,
}

impl<'a> ParameterValidator<'a> {
    pub fn new(schema_loader: &'a SchemaLoader) -> Self {
        Self { schema_loader }
    }
    
    pub fn validate(
        &self,
        node_type: &str,
        parameters: &HashMap<String, serde_json::Value>,
        type_version: i32,
    ) -> Result<HashMap<String, serde_json::Value>, Vec<ValidationError>> {
        let schema = self.schema_loader.get(node_type)
            .ok_or_else(|| vec![ValidationError::UnknownNodeType(node_type.to_string())])?;
        
        let mut errors = Vec::new();
        let mut sanitized = HashMap::new();
        
        // Check for unknown properties
        for (key, value) in parameters {
            if !schema.properties.iter().any(|p| p.name == *key) {
                errors.push(ValidationError::UnknownProperty {
                    node_type: node_type.to_string(),
                    property: key.clone(),
                });
            } else {
                sanitized.insert(key.clone(), value.clone());
            }
        }
        
        // Check required properties
        for prop in &schema.properties {
            if prop.required.unwrap_or(false) && !parameters.contains_key(&prop.name) {
                // Check if property is visible for this configuration
                if self.is_property_visible(prop, parameters, type_version) {
                    errors.push(ValidationError::MissingRequired {
                        property: prop.name.clone(),
                    });
                }
            }
        }
        
        // Validate option values
        for prop in &schema.properties {
            if let Some(value) = parameters.get(&prop.name) {
                if let Some(options) = &prop.options {
                    let valid_values: Vec<&serde_json::Value> = options.iter().map(|o| &o.value).collect();
                    if !valid_values.contains(&value) {
                        errors.push(ValidationError::InvalidOptionValue {
                            property: prop.name.clone(),
                            value: value.to_string(),
                            valid_options: valid_values.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(", "),
                        });
                    }
                }
            }
        }
        
        if errors.is_empty() {
            Ok(sanitized)
        } else {
            Err(errors)
        }
    }
    
    fn is_property_visible(
        &self,
        prop: &PropertySchema,
        parameters: &HashMap<String, serde_json::Value>,
        _type_version: i32,
    ) -> bool {
        // TODO: Implement displayOptions logic
        // For now, assume all properties are visible
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_validator_creation() {
        let loader = SchemaLoader::new();
        let _validator = ParameterValidator::new(&loader);
    }
}
